#!/usr/bin/env node
/**
 * detectops — command-line manager for DetectOps labs.
 *
 * Manages the full lifecycle (list · create · start · stop · destroy · status)
 * of all three lab types — Local Lab, Cloud Lab, Fleet Lab — by driving the same
 * HTTP API the dashboard uses (default http://localhost:3000). Zero dependencies:
 * Node 18+ built-in fetch only. It ADDS nothing to and removes nothing from your
 * running labs beyond the action you ask for.
 *
 * Auth: in dev mode (default) no auth is needed. If the server runs with
 * AUTH_ENFORCE=1, pass a session token via --token or DETECTOPS_SESSION (the
 * value of the `do_session` cookie).
 *
 * Usage:  detectops <local|cloud|fleet|all> <action> [flags]
 * Help:   detectops --help   ·   detectops <group> --help
 */

// ── config / globals ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const BOOL = new Set(["--json", "--yes", "-y", "--wait", "--no-color", "--abort",
  "--managed", "--connect", "--help", "-h", "--all", "--quiet"]);

function parseArgs(list) {
  const pos = []; const flags = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith("--") || (a.startsWith("-") && a.length === 2 && !/^-\d/.test(a))) {
      const key = a.replace(/^--?/, "");
      if (BOOL.has(a)) { flags[key] = true; }
      else { flags[key] = list[i + 1]; i++; }
    } else pos.push(a);
  }
  return { pos, flags };
}
const { pos, flags } = parseArgs(argv);
const [group, action] = pos;

const HOST = (flags.host || process.env.DETECTOPS_HOST || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = flags.token || process.env.DETECTOPS_SESSION || "";
const JSON_OUT = !!flags.json;
const YES = !!flags.yes || !!flags.y;
const WAIT = !!flags.wait;

// ── colors ───────────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !flags["no-color"] && !JSON_OUT;
const C = (n) => (s) => (useColor ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const dim = C(2), bold = C(1), red = C(31), grn = C(32), ylw = C(33), blu = C(34), cyn = C(36);
const ok = (s) => console.log(`  ${grn("✓")} ${s}`);
const warn = (s) => console.log(`  ${ylw("!")} ${s}`);
const info = (s) => console.log(`  ${dim(s)}`);
const step = (s) => console.log(`${blu("▸")} ${s}`);
function die(msg, code = 1) { console.error(`  ${red("✗")} ${msg}`); process.exit(code); }

// ── http ─────────────────────────────────────────────────────────────────────
async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers.Cookie = `do_session=${TOKEN}`;
  let res;
  try {
    res = await fetch(`${HOST}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    die(`Cannot reach DetectOps at ${HOST} (${e.message}). Is the app running?  ./start-server.sh`);
  }
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (res.status === 401) die("Unauthorized. The server enforces auth — pass --token <do_session> (or set DETECTOPS_SESSION).");
  if (!res.ok) die(`${method} ${path} → ${res.status}: ${data.error || data.raw || res.statusText}`);
  return data;
}
const cloud = (p, opt) => api(`/api/detection-lab/cloud/${p}`, opt);

// ── output helpers ───────────────────────────────────────────────────────────
function out(obj) { if (JSON_OUT) console.log(JSON.stringify(obj, null, 2)); }
function table(rows, cols) {
  if (JSON_OUT) return;
  if (!rows.length) { info("(none)"); return; }
  const widths = cols.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? "").length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log("  " + bold(line(cols.map((c) => c.label))));
  for (const r of rows) console.log("  " + line(cols.map((c) => (c.color ? c.color(r[c.key] ?? "") : (r[c.key] ?? "")))));
}
function statusColor(s) {
  s = String(s || "").toLowerCase();
  if (["running", "online", "up"].includes(s)) return grn(s);
  if (["unreachable", "missing", "error", "failed"].includes(s)) return red(s);
  if (["partial", "installing", "starting", "deploying", "installed", "queued", "build_lab", "build_vpn", "wait_for_vpn"].includes(s)) return ylw(s);
  return dim(s || "unknown");
}
async function confirm(prompt) {
  if (YES) return true;
  if (!process.stdin.isTTY) die(`Refusing a destructive action non-interactively. Re-run with --yes to confirm. (${prompt})`);
  const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`  ${ylw("?")} ${prompt} type 'yes' to proceed: `)).trim();
  rl.close();
  return ans === "yes";
}

// ── LOCAL LAB ────────────────────────────────────────────────────────────────
async function localTemplates() {
  const d = await api("/api/detection-lab/templates?mode=on-prem");
  out(d);
  table((d.templates || []).map((t) => ({
    id: t.id, name: t.name, labType: t.labType || "", vms: (t.config?.vms || t.vms || []).length || "",
  })), [{ key: "id", label: "ID", color: cyn }, { key: "name", label: "NAME" }, { key: "labType", label: "TYPE" }]);
}
async function localList() {
  const d = await api("/api/detection-lab/system-info");
  const envs = d.installedEnvironments || [];
  out({ installedEnvironments: envs });
  table(envs.map((e) => ({
    id: e.id, name: e.templateName || e.name, type: e.type + (e.fleetLab ? " (fleet)" : ""),
    status: e.status, vms: (e.vmNames || []).length, path: e.path,
  })), [
    { key: "id", label: "ID", color: cyn }, { key: "name", label: "NAME" }, { key: "type", label: "TYPE" },
    { key: "status", label: "STATUS", color: statusColor }, { key: "vms", label: "VMs" }, { key: "path", label: "PATH", color: dim },
  ]);
}
async function resolveLocal() {
  const d = await api("/api/detection-lab/system-info");
  const envs = d.installedEnvironments || [];
  let matches = envs;
  if (flags.id) matches = envs.filter((e) => e.id === flags.id);
  else if (flags.path) matches = envs.filter((e) => e.path === flags.path);
  else if (flags.name) matches = envs.filter((e) => `${e.templateName || ""} ${e.name || ""}`.toLowerCase().includes(String(flags.name).toLowerCase()));
  else die("Specify a target: --id <id> | --name <substr> | --path <deployPath>  (see `detectops local list`).");
  if (matches.length === 0) die("No matching local lab found. Try `detectops local list`.");
  if (matches.length > 1) die(`Ambiguous — ${matches.length} labs match. Narrow with --id or --path:\n` + matches.map((m) => `      ${m.id}  ${m.templateName || m.name}  ${m.path}`).join("\n"));
  return matches[0];
}
function localConfigFromFlags() {
  const cfg = {};
  if (flags["network-base"]) cfg.networkBase = flags["network-base"];
  if (flags["admin-pw"]) cfg.splunk_admin_password = flags["admin-pw"];
  const res = {};
  if (flags["splunk-ram"] || flags["splunk-cpus"]) res.splunk_server = { ...(flags["splunk-ram"] && { memory: +flags["splunk-ram"] }), ...(flags["splunk-cpus"] && { cpus: +flags["splunk-cpus"] }) };
  if (flags["win-ram"] || flags["win-cpus"]) res.windows_domain_controller = { ...(flags["win-ram"] && { memory: +flags["win-ram"] }), ...(flags["win-cpus"] && { cpus: +flags["win-cpus"] }) };
  if (Object.keys(res).length) cfg.resources = res;
  return cfg;
}
async function localCreate(templateId) {
  const tId = templateId || flags.template;
  if (!tId) die("Provide --template <id> (see `detectops local templates`).");
  const cap = await api("/api/deploy/capabilities").catch(() => ({}));
  if (cap && cap.localAvailable === false) warn("Host reports local deploy unavailable (needs VirtualBox+Vagrant / PLATFORM_MODE=self-hosted) — attempting anyway.");
  step(`Deploying local lab "${tId}" …`);
  const body = { templateId: tId, phase: "prepare", autoChain: true, config: localConfigFromFlags() };
  if (flags["deploy-path"]) body.deployPath = flags["deploy-path"];
  const d = await api("/api/detection-lab/deploy", { method: "POST", body });
  const dp = d.deployment?.deployPath;
  out(d);
  if (!dp) die("Deploy did not return a deployPath. " + (d.error || ""));
  ok(`Deploy started → ${dp}`);
  info("Build runs server-side (Vagrant + Ansible) — 10–20 min on first run. It continues even if you close this.");
  if (WAIT) await waitLocal(dp);
  else info(`Watch it: detectops local status --path "${dp}"   (or add --wait)`);
}
async function waitLocal(deployPath) {
  step("Waiting for the build to finish (Ctrl-C to stop watching — the build keeps running)…");
  let last = "";
  for (;;) {
    const d = await api(`/api/detection-lab/deploy?deployPath=${encodeURIComponent(deployPath)}`).catch(() => null);
    const s = d?.deployment;
    const prep = s?.phases?.prepare?.status, sar = s?.phases?.sar?.status;
    const logs = [...(s?.phases?.prepare?.logs || []), ...(s?.phases?.sar?.logs || [])];
    const tail = logs[logs.length - 1] || "";
    if (tail && tail !== last) { info(tail.slice(0, 140)); last = tail; }
    if (sar === "success") { ok("Splunk lab is up."); return; }
    if (sar === "failed" || prep === "failed") die("Deploy failed — see logs above / the dashboard.");
    await new Promise((r) => setTimeout(r, 5000));
  }
}
async function localLifecycle(act) {
  const env = await resolveLocal();
  const label = env.templateName || env.name;
  if (act === "destroy" && !(await confirm(`Destroy "${label}" (${(env.vmNames || []).length} VMs at ${env.path})?`))) return info("Aborted.");
  const apiAction = act === "start" ? "resume" : act; // engine uses "resume" for start
  step(`${act} → ${label} …`);
  const d = await api("/api/detection-lab/deploy", { method: "POST", body: { action: apiAction, deployPath: env.path } });
  out(d);
  (d.results || [d.message || "done"]).forEach((l) => info(l));
  ok(`${act} complete for "${label}".`);
}
async function localStatus() {
  const env = await resolveLocal();
  const d = await api(`/api/detection-lab/deploy?deployPath=${encodeURIComponent(env.path)}`).catch(() => null);
  out({ env, deployment: d?.deployment });
  console.log(`  ${bold(env.templateName || env.name)}  [${statusColor(env.status)}]`);
  info(`path:   ${env.path}`);
  info(`access: ${env.accessUrl || "—"}`);
  (env.vms || env.vmNames || []).forEach((v) => info(`vm:     ${v}`));
  const ph = d?.deployment?.phases;
  if (ph) for (const [k, v] of Object.entries(ph)) info(`phase ${k}: ${v.status}`);
}
async function localVm(vmAction) {
  if (!flags.vm) die("Provide --vm <vmName> (see `detectops local status`).");
  const d = await api("/api/detection-lab/vm", { method: "POST", body: { vmName: flags.vm, action: vmAction } });
  out(d); ok(`VM ${flags.vm}: ${d.message || d.state || vmAction}`);
}

// ── CLOUD LAB ────────────────────────────────────────────────────────────────
async function cloudHealth() {
  const d = await cloud("health").catch(() => ({ ok: false }));
  const p = await cloud("providers/check").catch(() => ({ providers: [] }));
  out({ health: d, providers: p.providers });
  console.log(`  Controller: ${d && d.ok !== false ? grn("reachable") : red("not reachable")}`);
  table((p.providers || []).map((x) => ({ provider: x.provider, available: x.available ? "yes" : "no" })),
    [{ key: "provider", label: "PROVIDER" }, { key: "available", label: "CLI READY", color: (v) => (v === "yes" ? grn(v) : dim(v)) }]);
}
async function cloudTemplates() {
  const d = await cloud("templates");
  out(d);
  table((d.templates || []).map((t) => ({ name: t.name, provider: t.provider, hosts: (t.architecture || []).length, ready: t.provider_available ? "yes" : "no" })),
    [{ key: "name", label: "TEMPLATE", color: cyn }, { key: "provider", label: "PROVIDER" }, { key: "hosts", label: "HOSTS" }, { key: "ready", label: "CLI", color: (v) => (v === "yes" ? grn(v) : dim(v)) }]);
}
async function cloudList() {
  const d = await cloud("attack-range/list");
  const ranges = d.attack_ranges || [];
  out({ attack_ranges: ranges });
  table(ranges.map((r) => ({ id: r.attack_range_id || r.attack_range_name, name: r.attack_range_name || "", status: r.status, ip: r.router_public_ip || "" })),
    [{ key: "id", label: "ID", color: cyn }, { key: "name", label: "NAME" }, { key: "status", label: "STATUS", color: statusColor }, { key: "ip", label: "ROUTER IP", color: dim }]);
}
async function cloudCreate() {
  let body;
  if (flags.body) {
    body = flags.body.startsWith("@") ? JSON.parse((await import("node:fs")).readFileSync(flags.body.slice(1), "utf8")) : JSON.parse(flags.body);
  } else {
    if (!flags.template) die("Provide --template <name> (see `detectops cloud templates`) or --body '<json>'.");
    body = { template: flags.template };
    // --set-general k=v (repeatable via comma) → general_overrides
    if (flags["set-general"]) { body.general_overrides = {}; for (const kv of String(flags["set-general"]).split(",")) { const [k, ...v] = kv.split("="); body.general_overrides[k.trim()] = v.join("=").trim(); } }
  }
  step(`Building cloud range from template "${body.template || "(custom)"}" …`);
  const d = await cloud("attack-range/build", { method: "POST", body });
  out(d);
  ok(`Build queued${d.attack_range_id ? ` → ${d.attack_range_id}` : ""}.`);
  info("Provisions in your cloud (queued → build_vpn → build_lab → running). Watch: `detectops cloud list`.");
}
async function cloudDestroy() {
  const id = flags.id || flags.name;
  if (!id) die("Provide --id <attack_range_id> (see `detectops cloud list`). Add --abort for an in-progress build.");
  const isAbort = !!flags.abort;
  if (!(await confirm(`${isAbort ? "Abort build for" : "Destroy cloud range"} "${id}" (releases cloud resources)?`))) return info("Aborted.");
  const d = await cloud(`attack-range/${isAbort ? "abort" : "destroy"}`, { method: "POST", body: { attack_range_id: id } });
  out(d); ok(d.message || (isAbort ? "Build aborted." : "Range destroyed."));
}

// ── FLEET LAB ────────────────────────────────────────────────────────────────
async function fleetList() {
  const c2 = await api("/api/c2").catch(() => ({ items: [] }));
  const fleets = await api("/api/fleets").catch(() => ({ items: [] }));
  const sys = await api("/api/detection-lab/system-info").catch(() => ({ installedEnvironments: [] }));
  const labs = (sys.installedEnvironments || []).filter((e) => e.fleetLab);
  out({ c2: c2.items, fleets: fleets.items, detectionLabs: labs });
  console.log(bold("  C2 servers"));
  table((c2.items || []).map((s) => ({ id: s.id, name: s.name, provider: s.provider, mode: s.mode, status: s.status, url: s.url || "" })),
    [{ key: "id", label: "ID", color: cyn }, { key: "name", label: "NAME" }, { key: "provider", label: "PROV" }, { key: "mode", label: "MODE" }, { key: "status", label: "STATUS", color: statusColor }, { key: "url", label: "URL", color: dim }]);
  console.log(bold("\n  Native agent fleets"));
  table((fleets.items || []).map((f) => ({ id: f.id, name: f.name, nodes: f.nodeCount, online: f.onlineCount })),
    [{ key: "id", label: "ID", color: cyn }, { key: "name", label: "NAME" }, { key: "nodes", label: "NODES" }, { key: "online", label: "ONLINE" }]);
  console.log(bold("\n  Fleet detection labs (Splunk)"));
  table(labs.map((e) => ({ id: e.id, name: e.templateName || e.name, status: e.status, path: e.path })),
    [{ key: "id", label: "ID", color: cyn }, { key: "name", label: "NAME" }, { key: "status", label: "STATUS", color: statusColor }, { key: "path", label: "PATH", color: dim }]);
  info("\nManage a fleet Splunk lab with `detectops local start|stop|destroy --id <id>`.");
}
async function fleetCreate() {
  const provider = flags.provider || "caldera";
  const mode = flags.connect ? "connect" : "managed"; // default: deploy a standalone server
  const body = { name: flags.name || `${provider}-${mode}`, provider, mode, group: flags.group || "red" };
  if (mode === "connect") { if (!flags.url || !flags["api-key"]) die("connect mode needs --url and --api-key."); body.url = flags.url; body.apiKey = flags["api-key"]; }
  else if (flags["advertise-host"]) body.advertiseHost = flags["advertise-host"];
  step(`${mode === "connect" ? "Connecting" : "Deploying"} ${provider} C2 …`);
  const d = await api("/api/c2", { method: "POST", body });
  out(d);
  ok(`C2 "${body.name}" ${mode === "connect" ? "connected" : "deploy started"}${d.id ? ` (${d.id})` : ""}.`);
  if (d.health && d.health.ok === false) warn(`health check: ${d.health.error}`);
}
async function fleetLifecycle(act) {
  if (!flags.id) die("Provide --id <c2-id> (see `detectops fleet list`).");
  if (act === "destroy") {
    if (!(await confirm(`Delete C2 server ${flags.id} (a managed one is torn down)?`))) return info("Aborted.");
    const d = await api(`/api/c2/${flags.id}`, { method: "DELETE" }); out(d); return ok(`C2 ${flags.id} removed — ${d.teardown || "done"}.`);
  }
  const body = { action: act === "start" ? "start" : "stop" };
  if (act === "start" && flags["advertise-host"]) body.advertiseHost = flags["advertise-host"];
  const d = await api(`/api/c2/${flags.id}/lifecycle`, { method: "POST", body });
  out(d); ok(`C2 ${flags.id}: ${act} requested.`);
}
async function fleetLabCreate() {
  step("Deploying the Fleet detection lab (Splunk + Windows) …");
  const body = { templateId: "sar-fleet-detection", phase: "prepare", autoChain: true, config: localConfigFromFlags() };
  if (flags["deploy-path"]) body.deployPath = flags["deploy-path"];
  const d = await api("/api/detection-lab/deploy", { method: "POST", body });
  const dp = d.deployment?.deployPath; out(d);
  if (!dp) die("Deploy did not return a deployPath. " + (d.error || ""));
  ok(`Fleet detection lab deploy started → ${dp}`);
  if (WAIT) await waitLocal(dp); else info(`Watch: detectops local status --path "${dp}"  (or add --wait)`);
}

// ── ALL ──────────────────────────────────────────────────────────────────────
async function allStatus() {
  console.log(bold("\nLocal & fleet VM labs")); await localList().catch((e) => warn(e.message));
  console.log(bold("\nCloud ranges")); await cloudList().catch(() => info("cloud controller not reachable"));
  console.log(bold("\nFleet C2 / agents")); await fleetList().catch((e) => warn(e.message));
}

// ── help ─────────────────────────────────────────────────────────────────────
const HELP = `${bold("detectops")} — manage DetectOps labs from the command line

${bold("USAGE")}
  detectops <group> <action> [flags]

${bold("GROUPS & ACTIONS")}
  ${cyn("local")}   templates | list | create | start | stop | destroy | status | vm-start | vm-stop
  ${cyn("cloud")}   health | templates | list | create | destroy | status
  ${cyn("fleet")}   list | create | start | stop | destroy | lab-create
  ${cyn("all")}     status

${bold("COMMON")}
  detectops all status
  detectops local templates
  detectops local create --template sar-minimal --network-base 192.168.56 --wait
  detectops local stop  --name "SAR Minimal"
  detectops local start --id <id>
  detectops local destroy --path <deployPath> --yes
  detectops cloud health
  detectops cloud create --template aws_sar_minimal --set-general key=value
  detectops cloud destroy --id <range_id> [--abort] --yes
  detectops fleet create --provider caldera --managed --advertise-host 192.168.1.20
  detectops fleet start|stop|destroy --id <c2-id>
  detectops fleet lab-create --wait

${bold("TARGETING (local/fleet-lab)")}   --id <id> | --name <substr> | --path <deployPath>
${bold("CREATE FLAGS (local)")}          --template --network-base --admin-pw --splunk-ram --splunk-cpus --win-ram --win-cpus --deploy-path
${bold("GLOBAL FLAGS")}
  --host <url>     API base (default http://localhost:3000, or DETECTOPS_HOST)
  --token <tok>    do_session cookie for AUTH_ENFORCE=1 (or DETECTOPS_SESSION)
  --wait           poll create until the lab is up
  --yes, -y        skip the destroy confirmation
  --json           machine-readable JSON output
  --no-color       plain output
`;

// ── dispatch ─────────────────────────────────────────────────────────────────
async function main() {
  if (flags.help || flags.h || !group) { console.log(HELP); process.exit(group ? 0 : 1); }
  const routes = {
    local: { templates: localTemplates, list: localList, create: () => localCreate(), start: () => localLifecycle("start"), stop: () => localLifecycle("stop"), destroy: () => localLifecycle("destroy"), status: localStatus, "vm-start": () => localVm("start"), "vm-stop": () => localVm("poweroff") },
    cloud: { health: cloudHealth, templates: cloudTemplates, list: cloudList, create: cloudCreate, destroy: cloudDestroy, status: cloudList },
    fleet: { list: fleetList, create: fleetCreate, start: () => fleetLifecycle("start"), stop: () => fleetLifecycle("stop"), destroy: () => fleetLifecycle("destroy"), "lab-create": fleetLabCreate },
    all: { status: allStatus },
  };
  const g = routes[group];
  if (!g) die(`Unknown group "${group}". Use: local | cloud | fleet | all.  (detectops --help)`);
  const fn = g[action];
  if (!fn) die(`Unknown action "${action || ""}" for ${group}. Actions: ${Object.keys(g).join(" | ")}.`);
  await fn();
}
main().catch((e) => die(e?.message || String(e)));
