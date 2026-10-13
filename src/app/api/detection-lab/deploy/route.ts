/**
 * Phased Detection Engineering Lab Deployment
 *
 * POST /api/detection-lab/deploy
 *   { templateId, deployPath, phase: "prepare" | "sar" | "goad" | "tools" }
 *     Run a single deployment phase. Each phase is independent and re-runnable.
 *   { action: "stop"|"resume"|"destroy", deployPath }
 *     Lifecycle management of an existing deployment.
 *
 * GET /api/detection-lab/deploy[?deployPath=...]
 *   Returns the active deployment state (or the saved state at deployPath).
 *
 * Phases:
 *   1. prepare — clean target dir, copy SAR + GOAD source, patch Vagrantfiles
 *   2. sar     — `python attack_range_local.py -a build`, verify Splunk Web/HEC
 *   3. goad    — `vagrant up` GOAD VMs, wait for WinRM, install Splunk Forwarder
 *                + Sysmon (which provides network/domain/log forwarding config)
 *   4. tools   — adversary tools (PurpleSharp etc) — skipped for now
 */

import { NextRequest, NextResponse } from "next/server";
import { getTemplate } from "@/config/lab-templates";
import { execFile, spawn as nodeSpawn } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { writeFile, rm } from "fs/promises";
import path from "path";
import os from "os";

const exec = promisify(execFile);

/**
 * Expand a leading `~` to the OS home directory. The client sends deploy paths
 * like "~/.detectops-labs/<id>", but Node's fs/spawn never expand `~` (only a
 * shell does) — so without this the lab would be created in a literal "~" dir
 * relative to the server's CWD and the SAR build would run against a bogus path.
 */
function expandHome(p: string | null | undefined): string {
  if (!p) return p || "";
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  // A relative deployPath (e.g. ".detectops-labs/<id>") resolves to the project
  // root, so local labs deploy onto the project's big disk rather than wherever
  // the server happens to be invoked from.
  if (!path.isAbsolute(p)) return path.join(process.cwd(), p);
  return p;
}
const SAR_SOURCE = process.env.SAR_PATH || "/media/nested/SamsungEvo/Simulation/attack_range_local";
const GOAD_SOURCE = process.env.GOAD_PATH || "/media/nested/SamsungEvo/Projects/GOAD/GOAD";

// Global registry of successfully deployed labs — persists across dev server restarts
// so the "Detected Environments" panel shows deployments until explicitly destroyed.
const DEPLOYMENTS_REGISTRY = path.join(process.cwd(), "labs", ".deployments-registry.json");

interface RegistryEntry {
  id: string;
  templateId: string;
  templateName: string;
  labType: string;
  prefix: string;
  deployPath: string;
  vmNames: Record<string, string>;
  createdAt: string;
  lastDeployedAt: string;
}

function loadRegistry(): RegistryEntry[] {
  try {
    if (!existsSync(DEPLOYMENTS_REGISTRY)) return [];
    return JSON.parse(readFileSync(DEPLOYMENTS_REGISTRY, "utf-8"));
  } catch { return []; }
}

function saveRegistry(entries: RegistryEntry[]) {
  try {
    mkdirSync(path.dirname(DEPLOYMENTS_REGISTRY), { recursive: true });
    writeFileSync(DEPLOYMENTS_REGISTRY, JSON.stringify(entries, null, 2));
  } catch { /* best-effort */ }
}

function registerDeployment(state: DeploymentState) {
  const entries = loadRegistry();
  const existing = entries.findIndex((e) => e.deployPath === state.deployPath);
  const entry: RegistryEntry = {
    id: state.id,
    templateId: state.templateId,
    templateName: state.templateName,
    labType: state.labType,
    prefix: state.prefix,
    deployPath: state.deployPath,
    vmNames: state.vmNames,
    createdAt: state.createdAt,
    lastDeployedAt: new Date().toISOString(),
  };
  if (existing >= 0) entries[existing] = entry;
  else entries.push(entry);
  saveRegistry(entries);
}

function unregisterDeployment(deployPath: string) {
  const entries = loadRegistry().filter((e) => e.deployPath !== deployPath);
  saveRegistry(entries);
}

// ── Phase model ──

type PhaseName = "prepare" | "sar" | "goad" | "tools";
type PhaseStatus = "pending" | "running" | "success" | "failed" | "skipped";

interface PhaseState {
  status: PhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number;
  logs: string[];
  error: string | null;
  result: Record<string, any>;
}

interface DeploymentState {
  id: string;
  templateId: string;
  templateName: string;
  labType: string;
  deployPath: string;
  prefix: string;
  vmNames: Record<string, string>;
  createdAt: string;
  currentPhase: PhaseName | null;
  phases: Record<PhaseName, PhaseState>;
  // User customization captured at prepare time (RAM/CPU/network/creds), merged
  // over the template's own config. Applied to attack_range_local.conf on prepare.
  config?: Record<string, any>;
}

let active: DeploymentState | null = null;
let activeRun: Promise<void> | null = null;

function emptyPhase(): PhaseState {
  return { status: "pending", startedAt: null, completedAt: null, durationMs: 0, logs: [], error: null, result: {} };
}

function newDeploymentState(template: any, deployPath: string, config?: Record<string, any>): DeploymentState {
  const prefix = `lab-${Date.now().toString(36).slice(-6)}`;
  const vmNames: Record<string, string> = {};
  for (const vm of template.vms) vmNames[vm.name] = `${prefix}-${vm.name}`;
  return {
    id: `deploy-${Date.now().toString(36)}`,
    templateId: template.id,
    templateName: template.name,
    labType: template.labType,
    deployPath, prefix, vmNames,
    config: { ...(template.config || {}), ...(config || {}) },
    createdAt: new Date().toISOString(),
    currentPhase: null,
    phases: {
      prepare: emptyPhase(),
      sar: emptyPhase(),
      goad: emptyPhase(),
      tools: { ...emptyPhase(), status: "skipped" },
    },
  };
}

function statePath(deployPath: string) { return path.join(deployPath, "deployment-state.json"); }

function saveState(state: DeploymentState) {
  try {
    if (!existsSync(state.deployPath)) mkdirSync(state.deployPath, { recursive: true });
    writeFileSync(statePath(state.deployPath), JSON.stringify(state, null, 2));
  } catch { /* best-effort */ }
}

function loadState(deployPath: string): DeploymentState | null {
  try {
    const p = statePath(deployPath);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch { return null; }
}

function logTo(state: DeploymentState, phase: PhaseName, msg: string) {
  const ts = new Date().toISOString().split("T")[1].split(".")[0];
  state.phases[phase].logs.push(`[${ts}] ${msg}`);
  // Keep a generous rolling window so a long SAR/GOAD build's output stays
  // visible in the UI. The complete, untruncated output is also written to the
  // phase's build log file on disk (see spawnAndWait).
  if (state.phases[phase].logs.length > 3000) {
    state.phases[phase].logs = state.phases[phase].logs.slice(-3000);
  }
}

async function runPhase(state: DeploymentState, phase: PhaseName, fn: () => Promise<void>) {
  state.currentPhase = phase;
  state.phases[phase] = { ...emptyPhase(), status: "running", startedAt: new Date().toISOString() };
  saveState(state);

  const start = Date.now();
  try {
    await fn();
    state.phases[phase].status = "success";
    state.phases[phase].completedAt = new Date().toISOString();
    state.phases[phase].durationMs = Date.now() - start;

    // Register deployment in the global registry once the final meaningful phase
    // completes. For sar-goad templates this is the "goad" phase (AD online);
    // for sar-only templates it's the "sar" phase.
    const isFinalPhase =
      (state.labType === "sar-goad" && phase === "goad") ||
      (state.labType === "sar" && phase === "sar") ||
      (state.labType === "sar-docker" && phase === "sar");
    if (isFinalPhase) {
      registerDeployment(state);
      logTo(state, phase, `Registered deployment in global registry: ${DEPLOYMENTS_REGISTRY}`);
    }
  } catch (err: any) {
    state.phases[phase].status = "failed";
    state.phases[phase].error = err.message || String(err);
    state.phases[phase].completedAt = new Date().toISOString();
    state.phases[phase].durationMs = Date.now() - start;
    logTo(state, phase, `FAILED: ${err.message}`);
  } finally {
    state.currentPhase = null;
    saveState(state);
  }
}

// ══════════════════════════════════════════════
// HTTP handlers
// ══════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dp = expandHome(searchParams.get("deployPath"));
  if (dp) {
    const persisted = loadState(dp);
    return NextResponse.json({ deployment: persisted, hasActive: false });
  }
  return NextResponse.json({
    deployment: active,
    hasActive: active?.currentPhase !== null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.action) return handleLifecycle(body.action, expandHome(body.deployPath));

  const { templateId, phase } = body;
  // Deploy under the PROJECT path by default (so VM disks live in the repo tree),
  // unless the caller explicitly provides a path.
  const deployPath = expandHome(body.deployPath) || (templateId ? path.join(process.cwd(), "labs", "deployments", String(templateId)) : "");
  if (!templateId) return NextResponse.json({ error: "templateId required" }, { status: 400 });
  if (!deployPath) return NextResponse.json({ error: "deployPath required" }, { status: 400 });
  if (!phase) return NextResponse.json({ error: "phase required (prepare|sar|goad|tools)" }, { status: 400 });
  if (!["prepare", "sar", "goad", "tools"].includes(phase))
    return NextResponse.json({ error: "invalid phase" }, { status: 400 });

  const template = getTemplate(templateId);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Don't run if a phase is already running
  if (active && active.currentPhase !== null) {
    return NextResponse.json({
      error: `Phase '${active.currentPhase}' is already running`,
      deployment: active,
    }, { status: 409 });
  }

  // Load existing or create new state
  const existing = loadState(deployPath);
  if (existing && existing.templateId === template.id) {
    active = existing;
    // Allow refreshing customization on a re-prepare.
    if (phase === "prepare" && body.config) active.config = { ...(template.config || {}), ...body.config };
  } else {
    active = newDeploymentState(template, deployPath, body.config);
  }

  // Gate phases: each requires the previous one to be successful
  if (phase === "sar" && active.phases.prepare.status !== "success") {
    return NextResponse.json({ error: "Run 'prepare' phase first" }, { status: 400 });
  }
  if (phase === "goad" && active.phases.sar.status !== "success") {
    return NextResponse.json({ error: "Run 'sar' phase successfully first" }, { status: 400 });
  }

  // Skip GOAD phase entirely for SAR-only or SAR-Docker templates
  if (phase === "goad" && (active.labType === "sar" || active.labType === "sar-docker")) {
    active.phases.goad.status = "skipped";
    saveState(active);
    return NextResponse.json({ success: true, skipped: true, deployment: active });
  }

  // Run in background
  const runner: Record<PhaseName, () => Promise<void>> = {
    prepare: () => phasePrepare(active!, template),
    sar: () => phaseSAR(active!),
    goad: () => phaseGOAD(active!),
    tools: () => phaseTools(active!),
  };

  // Auto-chain: run all phases server-side (prepare → sar → goad-if-needed) in
  // one fire-and-forget sequence, so the deploy advances on its own instead of
  // relying on the browser to POST each next phase. Progress is polled from the
  // on-disk state (GET?deployPath=). Used by the Fleet "Detection Lab" deploy.
  if (body.autoChain && phase === "prepare") {
    const st = active;
    activeRun = (async () => {
      await runPhase(st, "prepare", runner.prepare);
      if (st.phases.prepare.status !== "success") return;
      await runPhase(st, "sar", runner.sar);
      if (st.phases.sar.status !== "success") return;
      if (st.labType === "sar-goad") await runPhase(st, "goad", runner.goad);
    })();
    return NextResponse.json({ success: true, autoChain: true, deployment: active });
  }

  activeRun = runPhase(active, phase, runner[phase as PhaseName]);
  // fire and forget — client polls GET

  return NextResponse.json({
    success: true,
    phase,
    deployment: active,
  });
}

// ══════════════════════════════════════════════
// PHASE 1 (prepare): clean + copy + patch
// ══════════════════════════════════════════════

async function phasePrepare(state: DeploymentState, template: any) {
  if (state.labType === "sar-docker") {
    return phasePrepareDocker(state, template);
  }

  const log = (m: string) => logTo(state, "prepare", m);
  log(`Preparing deploy directory: ${state.deployPath}`);

  // Sanity checks
  if (!existsSync(SAR_SOURCE)) throw new Error(`SAR source not found: ${SAR_SOURCE}`);
  if (state.labType === "sar-goad" && !existsSync(GOAD_SOURCE)) {
    throw new Error(`GOAD source not found: ${GOAD_SOURCE}`);
  }

  // Stop any running VMs that conflict (by name)
  await stopConflictingVMs(state.vmNames, log);

  // Clean target dir if it exists
  if (existsSync(state.deployPath)) {
    log("Cleaning existing deploy path...");
    await rm(state.deployPath, { recursive: true, force: true });
  }
  mkdirSync(state.deployPath, { recursive: true });

  // Copy SAR (with venv) using rsync — preserves symlinks/permissions, excludes .vagrant
  log(`Copying SAR from ${SAR_SOURCE} (this can take 1-2 minutes)...`);
  const sarDest = path.join(state.deployPath, "sar");
  try {
    await exec("rsync", [
      "-a", "--exclude=.vagrant", "--exclude=.git", "--exclude=packer",
      "--exclude=*.box", "--exclude=*.vmdk", "--exclude=*.vdi",
      SAR_SOURCE + "/", sarDest + "/",
    ], { timeout: 300000 });
    log("SAR copied successfully");
  } catch (e: any) {
    throw new Error(`SAR copy failed: ${e.message?.slice(0, 120)}`);
  }

  // Patch SAR Vagrantfile with unique VM names
  patchSARVagrantfile(sarDest, state.prefix, state.vmNames, log);

  // Apply user customization (RAM/CPU, enabled VMs, admin password, network base)
  // to attack_range_local.conf before build.
  patchSARConf(sarDest, state, log);

  // Patch VagrantController.py to use config-based credentials instead of hardcoded 'vagrant/vagrant'
  const vcPath = path.join(sarDest, "modules", "VagrantController.py");
  if (existsSync(vcPath)) {
    let vc = readFileSync(vcPath, "utf-8");
    vc = vc.replace(
      /'ansible_user': 'Vagrant', 'ansible_password': 'vagrant'/g,
      "'ansible_user': self.config.get('win_username', 'Administrator'), 'ansible_password': self.config.get('win_password', 'I-l1ke-Attack-Range!')"
    );
    writeFileSync(vcPath, vc);
    log("  Patched VagrantController.py credentials (vagrant → config-based)");
  }

  // Patch atomic_red_team.yml to use HTTP port 5985 instead of HTTPS 5986
  const artPlaybook = path.join(sarDest, "ansible", "atomic_red_team.yml");
  if (existsSync(artPlaybook)) {
    let art = readFileSync(artPlaybook, "utf-8");
    art = art.replace(/ansible_port:\s*5986/g, "ansible_port: 5985");
    if (!art.includes("ansible_winrm_scheme")) {
      art = art.replace(/ansible_port: 5985/g, "ansible_port: 5985\n    ansible_winrm_scheme: http");
    }
    writeFileSync(artPlaybook, art);
    log("  Patched atomic_red_team.yml (port 5986→5985, scheme→http)");
  }

  // Patch run_art_test.yml to handle credential disruption from attack techniques
  // (T1003 Mimikatz etc. can crash LSASS/WinRM causing auth failures on output collection)
  const artTestRunner = path.join(sarDest, "ansible", "roles", "atomic_red_team", "tasks", "run_art_test.yml");
  if (existsSync(artTestRunner)) {
    const patchedRunner = [
      '- set_fact:',
      '    technique: "{{ item }}"',
      '',
      '- debug:',
      '    var: technique',
      '',
      '- name: Get requirements for Atomic Red Team Technique',
      '  win_shell: |',
      '    Import-Module "C:\\AtomicRedTeam\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1" -Force',
      '    Invoke-AtomicTest "{{ technique }}" -GetPrereqs',
      '  register: requirements',
      '',
      '- name: Run specified Atomic Red Team Technique',
      '  win_shell: |',
      '    Import-Module "C:\\AtomicRedTeam\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1" -Force',
      '    $ErrorActionPreference = "Continue"',
      '    try {',
      '      Invoke-AtomicTest "{{ technique }}" -Confirm:$false -TimeoutSeconds 120 -ExecutionLogPath C:\\AtomicRedTeam\\atc_execution.csv',
      '    } catch {',
      '      Write-Output "ART execution completed with errors (expected for some techniques): $_"',
      '    }',
      '    Write-Output "ART_EXECUTION_DONE"',
      '  register: output',
      '  ignore_errors: yes',
      '  timeout: 180',
      '',
      '- debug:',
      '    var: output.stdout_lines',
      '  when: output is defined and output.stdout_lines is defined',
      '  ignore_errors: yes',
      '',
      '- name: Cleanup after execution',
      '  win_shell: |',
      '    Import-Module "C:\\AtomicRedTeam\\invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1" -Force',
      '    Invoke-AtomicTest "{{ technique }}" -Cleanup',
      '  register: cleanup',
      '  ignore_errors: yes',
      '  timeout: 120',
    ].join("\n") + "\n";
    writeFileSync(artTestRunner, patchedRunner);
    log("  Patched run_art_test.yml (ignore_errors + timeout for credential-disrupting techniques)");
  }

  // Copy GOAD if needed
  if (state.labType === "sar-goad") {
    log(`Copying GOAD from ${GOAD_SOURCE}...`);
    const goadDest = path.join(state.deployPath, "goad");
    await prepareGOAD(goadDest, state.prefix, state.vmNames, log);
    log("GOAD prepared");
  }

  // Write the public deployment metadata (read by lifecycle handlers)
  await writeFile(path.join(state.deployPath, "deployment.json"), JSON.stringify({
    id: state.id, templateId: state.templateId, templateName: state.templateName,
    labType: state.labType, prefix: state.prefix, deployPath: state.deployPath,
    vmNames: state.vmNames, createdAt: state.createdAt,
  }, null, 2));

  state.phases.prepare.result = {
    sarPath: sarDest,
    goadPath: state.labType === "sar-goad" ? path.join(state.deployPath, "goad") : null,
    vmCount: Object.keys(state.vmNames).length,
  };

  log("Prepare phase complete");
}

// ══════════════════════════════════════════════
// PHASE 2 (sar): build SAR VMs and verify Splunk
// ══════════════════════════════════════════════

async function phaseSAR(state: DeploymentState) {
  if (state.labType === "sar-docker") {
    return phaseSARDocker(state);
  }

  const log = (m: string) => logTo(state, "sar", m);

  const sarDir = path.join(state.deployPath, "sar");
  const python = path.join(sarDir, "venv", "bin", "python3");
  const script = path.join(sarDir, "attack_range_local.py");

  if (!existsSync(sarDir)) throw new Error("SAR directory missing — run prepare phase first");
  if (!existsSync(python)) throw new Error(`SAR venv python not found at ${python}`);
  if (!existsSync(script)) throw new Error(`attack_range_local.py not found in ${sarDir}`);

  // Point VirtualBox at the deploy path so VM disks land here
  const vmDir = path.join(state.deployPath, "vms");
  mkdirSync(vmDir, { recursive: true });
  const origFolder = await setVBoxFolder(vmDir, log);

  const sarBuildLog = path.join(state.deployPath, "sar-build.log");
  log("Starting SAR build (vagrant up + ansible provisioning)...");
  log("This typically takes 8-15 minutes for first build.");
  log(`Full build output is streamed below and saved to ${sarBuildLog}`);

  let buildOk = false;
  try {
    buildOk = await spawnAndWait(
      python, [script, "-a", "build"], sarDir, "SAR",
      {
        ...process.env,
        OBJC_DISABLE_INITIALIZE_FORK_SAFETY: "YES",
        PATH: `${path.join(sarDir, "venv", "bin")}:${process.env.PATH}`,
      },
      log,
      30 * 60 * 1000, // 30 minute timeout
      sarBuildLog,
    );
  } finally {
    await restoreVBoxFolder(origFolder);
  }

  if (!buildOk) {
    log("SAR build did NOT complete cleanly (see the build output above). Checking VM state anyway in case Splunk still came up...");
  }

  // Network-aware verification: derive the Splunk IP from the (possibly rebased)
  // network base, and only wait on a DC when the lab actually builds one.
  const cfg = state.config || {};
  const base = typeof cfg.networkBase === "string" && /^\d+\.\d+\.\d+$/.test(cfg.networkBase) ? cfg.networkBase : "10.0.1";
  const splunkIp = `${base}.12`;
  const dcIp = `${base}.14`;
  const toggles = (cfg.vmToggles || {}) as Record<string, number | boolean>;
  const hasDC = toggles.windows_domain_controller === undefined ? true : !!toggles.windows_domain_controller;

  // Verify Splunk is reachable — wait up to 5 minutes
  log(`Waiting for Splunk Web (${splunkIp}:8000)...`);
  const splunkWebUp = await waitFor(() => checkPort(splunkIp, 8000), 5 * 60 * 1000, 10000, "Splunk Web", log);
  if (!splunkWebUp) {
    throw new Error(
      (buildOk
        ? "Splunk Web (8000) did not come up after 5 minutes."
        : "SAR build failed (non-zero exit) and Splunk Web (8000) never came up. The build output above / the build log has the root cause.") +
      ` Full build log: ${sarBuildLog}. Verify VM state with: VBoxManage list runningvms`,
    );
  }

  log("Waiting for Splunk receiving port (9997)...");
  const recvUp = await waitFor(() => checkPort(splunkIp, 9997), 2 * 60 * 1000, 5000, "Splunk receiver", log);
  if (!recvUp) {
    throw new Error("Splunk receiving port (9997) is not open");
  }

  // Verify the Windows telemetry host (DC in the default lab; the workstation UF
  // host otherwise) — best-effort, never fatal.
  let dcUp = false;
  if (hasDC) {
    log(`Waiting for SAR Windows DC (${dcIp})...`);
    dcUp = await waitFor(() => pingHost(dcIp), 3 * 60 * 1000, 10000, "SAR DC", log);
    if (!dcUp) log("WARNING: SAR Windows DC not pinging — Splunk is up but lab may be incomplete");
  } else {
    log("No DC in this lab (workstation-only) — skipping DC check.");
  }

  state.phases.sar.result = {
    splunkWebUp: true,
    splunkRecvUp: true,
    splunkDcUp: dcUp,
    splunkUrl: `http://${splunkIp}:8000`,
    splunkIp,
    credentials: `admin / ${cfg.splunk_admin_password || "I-l1ke-Attack-Range!"}`,
  };

  log("SAR phase complete — Splunk is up and ready to receive logs");
}

// ══════════════════════════════════════════════
// PHASE 3 (goad): GOAD VMs + network + Splunk Forwarder
// ══════════════════════════════════════════════

async function phaseGOAD(state: DeploymentState) {
  const log = (m: string) => logTo(state, "goad", m);

  if (state.labType !== "sar-goad") {
    log("Template is SAR-only — skipping GOAD phase");
    return;
  }

  const goadVagrantDir = path.join(state.deployPath, "goad", "provider");
  if (!existsSync(goadVagrantDir)) {
    throw new Error(`GOAD vagrant dir missing: ${goadVagrantDir}`);
  }

  // Stop any conflicting GOAD VMs from the original install
  log("Stopping any pre-existing DC01/WS01 VMs from previous installs...");
  for (const vm of ["DC01", "WS01"]) {
    try {
      const { stdout } = await exec("VBoxManage", ["showvminfo", vm, "--machinereadable"], { timeout: 5000 });
      if (stdout.includes('VMState="running"')) {
        await exec("VBoxManage", ["controlvm", vm, "poweroff"], { timeout: 15000 });
        log(`  Stopped pre-existing ${vm}`);
        await sleep(3000);
      }
    } catch { /* not registered, skip */ }
  }

  // Point VBox at deploy path
  const vmDir = path.join(state.deployPath, "vms");
  mkdirSync(vmDir, { recursive: true });
  const origFolder = await setVBoxFolder(vmDir, log);

  // ─── DESTROY any leftover VMs from a previous failed Phase 2 ───
  // If our prefixed GOAD VMs already exist (because vagrant up was run before
  // but failed mid-provision), Vagrant will skip the provisioner and just power
  // them on, leaving the network unconfigured. We must destroy first.
  log("Destroying any leftover GOAD VMs from previous attempts...");
  try {
    await spawnAndWait(
      "vagrant", ["destroy", "-f"],
      goadVagrantDir, "GOAD-cleanup",
      { ...process.env },
      log,
      5 * 60 * 1000,
    );
  } catch { /* ignore — there may be nothing to destroy */ }

  // Also clean any orphaned VBox VMs with our prefix names (e.g. if .vagrant
  // metadata is stale but the VMs still exist in VBox)
  for (const goadVmName of [state.vmNames["DC01"], state.vmNames["WS01"]].filter(Boolean)) {
    try {
      const { stdout } = await exec("VBoxManage", ["showvminfo", goadVmName, "--machinereadable"], { timeout: 5000 });
      if (stdout.includes("VMState=")) {
        if (stdout.includes('VMState="running"')) {
          await exec("VBoxManage", ["controlvm", goadVmName, "poweroff"], { timeout: 15000 });
          await sleep(2000);
        }
        await exec("VBoxManage", ["unregistervm", goadVmName, "--delete"], { timeout: 30000 });
        log(`  Cleaned orphaned VM: ${goadVmName}`);
      }
    } catch { /* not registered */ }
  }

  log("Starting GOAD VMs (vagrant up --provision)...");
  log("First boot can take 10-15 minutes (Windows box import + WinRM config).");

  let goadOk = false;
  try {
    // --provision flag forces provisioning even if Vagrant thinks the VM is up.
    // This guarantees ConfigureRemotingForAnsible.ps1 runs and the network is set up.
    goadOk = await spawnAndWait(
      "vagrant", ["up", "--provider=virtualbox", "--provision"],
      goadVagrantDir, "GOAD",
      { ...process.env },
      log,
      30 * 60 * 1000,
    );
  } finally {
    await restoreVBoxFolder(origFolder);
  }

  if (!goadOk) {
    log("vagrant up returned non-zero — checking if VMs are still up...");
  }

  // ─── Step 2.1: Wait for VMs to be reachable via WinRM ───
  // NOTE: We deliberately do NOT use ping here. Windows defaults the host-only
  // NIC to a "Public" network profile which blocks ICMP via the firewall, even
  // when the VM is fully up and reachable. The Splunk Forwarder install role
  // (run later) disables the firewall, after which ping will work for the rest
  // of validation. Until then, WinRM (port 5985) is the authoritative liveness
  // check — it has its own firewall exception so it works regardless.
  log("");
  log("─── Network configuration check ───");
  log("Waiting for GOAD DC01 (10.0.1.30) WinRM to be reachable...");
  log("(WinRM is the reliable check — Windows blocks ICMP by default on the second NIC)");
  const dc01Winrm = await waitFor(() => checkPort("10.0.1.30", 5985), 8 * 60 * 1000, 10000, "DC01 WinRM", log);
  if (!dc01Winrm) {
    throw new Error(
      "DC01 WinRM (10.0.1.30:5985) not reachable after 8 minutes. " +
      "Check the VM in VirtualBox — the second NIC may not have come up. " +
      "Ensure host-only adapter for 10.0.1.0/24 exists (vboxnet with subnet 10.0.1.0/24)."
    );
  }
  log("DC01 is reachable via WinRM — VM is up and provisioned");

  log("Waiting for GOAD WS01 (10.0.1.31) WinRM...");
  const ws01Winrm = await waitFor(() => checkPort("10.0.1.31", 5985), 6 * 60 * 1000, 10000, "WS01 WinRM", log);
  if (!ws01Winrm) {
    log("WARNING: WS01 WinRM not accessible yet — will continue with DC01 only");
  } else {
    log("WS01 is reachable via WinRM");
  }

  // Try ping just for diagnostics (informational only — Windows firewall may block)
  const dc01PingTry = await pingHost("10.0.1.30");
  const ws01PingTry = ws01Winrm ? await pingHost("10.0.1.31") : false;
  log(`Diagnostic pings — DC01: ${dc01PingTry ? "OK" : "blocked (firewall)"} | WS01: ${ws01PingTry ? "OK" : "blocked (firewall)"}`);
  log("(Pings will start working after the Splunk Forwarder install disables the firewall)");

  const ws01Up = ws01Winrm; // alias used below

  // Cross-subnet check
  log("Verifying SAR Splunk (10.0.1.12) reachable from host...");
  const splunkUp = await pingHost("10.0.1.12");
  log(`SAR Splunk ping from host: ${splunkUp ? "OK" : "FAIL"} | DC01 WinRM: OK | Same subnet 10.0.1.0/24: ✓`);

  // ─── Step 2.2: Run GOAD AD provisioning playbooks ───
  // This is what was MISSING before — it does the actual domain controller setup
  // and joins WS01 to mini.lab. Without this the VMs are just blank Windows boxes.
  log("");
  log("─── GOAD AD Provisioning ───");
  log("Promoting DC01 to Domain Controller (mini.lab)");
  log("Joining WS01 to mini.lab domain");
  log("Creating users (alice, bob, carol, dave) and groups");
  log("This typically takes 15-25 minutes — Windows AD setup is slow.");

  const provisionResult = await runGOADProvisioning(path.join(state.deployPath, "goad"), log);
  if (!provisionResult.success) {
    throw new Error(`GOAD AD provisioning failed: ${provisionResult.error}`);
  }
  log(`GOAD AD provisioning complete (ran ${provisionResult.playbooksRun.length} playbooks)`);

  // ─── Step 2.3: Install Splunk Forwarder + Sysmon ───
  log("");
  log("─── Splunk Forwarder + Sysmon Installation ───");

  // Wait briefly for things to settle after the reboots that domain join causes
  log("Waiting 30s after domain join for DC01 to settle...");
  await sleep(30000);

  // After domain join, DC01 may need a moment to come back; verify WinRM (NOT ping —
  // Windows firewall blocks ICMP until the forwarder install disables it)
  const dc01StillUp = await waitFor(() => checkPort("10.0.1.30", 5985), 5 * 60 * 1000, 10000, "DC01 post-AD WinRM", log);
  if (!dc01StillUp) {
    throw new Error("DC01 WinRM not reachable after AD provisioning (likely still rebooting from DC promotion)");
  }

  log("Installing Splunk Forwarder + Sysmon on DC01...");
  const dc01Install = await installForwarder("dc01", "10.0.1.30", path.join(state.deployPath, "goad"), log);
  if (!dc01Install.success) {
    throw new Error(`DC01 forwarder install failed: ${dc01Install.error}`);
  }
  log("DC01 forwarder installed successfully");

  // Try WS01 if it's up
  let ws01InstallStatus = "skipped";
  if (ws01Up) {
    const ws01Winrm = await checkPort("10.0.1.31", 5985);
    if (ws01Winrm) {
      log("Installing Splunk Forwarder + Sysmon on WS01...");
      const r = await installForwarder("ws01", "10.0.1.31", path.join(state.deployPath, "goad"), log);
      ws01InstallStatus = r.success ? "success" : `failed: ${r.error}`;
      log(`WS01 forwarder: ${ws01InstallStatus}`);
    } else {
      log("WS01 WinRM not accessible — skipping forwarder install");
    }
  }

  state.phases.goad.result = {
    dc01Up: true,
    dc01Winrm: true,
    ws01Up,
    adProvisioned: true,
    playbooksRun: provisionResult.playbooksRun,
    domain: "mini.lab",
    dc01ForwarderInstalled: true,
    ws01ForwarderInstalled: ws01InstallStatus === "success",
    crossPingOk: splunkUp,
  };

  log("GOAD phase complete — DC01 = mini.lab DC, WS01 domain-joined, both forwarding logs to SAR Splunk");
}

// ══════════════════════════════════════════════
// PHASE 4 (tools): skipped per user request
// ══════════════════════════════════════════════

async function phaseTools(state: DeploymentState) {
  const log = (m: string) => logTo(state, "tools", m);
  log("Tools phase intentionally skipped — will be implemented after lab is verified");
  state.phases.tools.status = "skipped";
}

// ══════════════════════════════════════════════
// SAR Docker phases (labType === "sar-docker")
// ══════════════════════════════════════════════

async function phasePrepareDocker(state: DeploymentState, template: any) {
  const log = (m: string) => logTo(state, "prepare", m);
  const cfg = template.config as Record<string, string>;
  const repoUrl = cfg.sar_repo || "https://github.com/splunk/attack_range";
  const repoRef = cfg.sar_ref || "main";
  const composeRel = cfg.compose_file || "docker/docker-compose.yml";

  log(`Preparing Docker deploy directory: ${state.deployPath}`);

  // 1. Ensure Docker + Compose are installed (attempts passwordless sudo apt-get)
  await ensureDocker(log);

  // 2. Pre-check: ports 4321 and 4000 must be free
  for (const port of [4321, 4000]) {
    if (await checkPort("127.0.0.1", port)) {
      throw new Error(`Port ${port} is already in use on localhost — stop the conflicting service or change the SAR compose ports.`);
    }
  }
  log("Ports 4321 and 4000 are free");

  // 3. Clean target dir if it exists, then clone SAR repo
  if (existsSync(state.deployPath)) {
    log("Cleaning existing deploy path...");
    await rm(state.deployPath, { recursive: true, force: true });
  }
  mkdirSync(state.deployPath, { recursive: true });

  const repoDest = path.join(state.deployPath, "attack_range");
  log(`Cloning ${repoUrl} (ref: ${repoRef}) → ${repoDest}`);
  try {
    const { stdout, stderr } = await exec(
      "git", ["clone", "--depth", "1", "--branch", repoRef, repoUrl, repoDest],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
    );
    if (stdout.trim()) log(`git: ${stdout.trim().split("\n").slice(-3).join(" | ")}`);
    if (stderr.trim()) log(`git: ${stderr.trim().split("\n").slice(-3).join(" | ")}`);
    log("Clone complete");
  } catch (e: any) {
    // exec's ExecFileException carries stdout/stderr as fields — those hold the real git error
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join(" | ").trim();
    log(`git clone failed — full output: ${detail}`);
    throw new Error(`git clone failed (branch '${repoRef}'): ${detail.slice(0, 600)}`);
  }

  // 4. Verify upstream docker compose file is where we expect
  const composePath = path.join(repoDest, composeRel);
  if (!existsSync(composePath)) {
    throw new Error(`Upstream compose file not found at ${composePath} — attack_range repo layout may have changed.`);
  }
  log(`Found compose file: ${composeRel}`);

  // 5. Write public deployment metadata (used by lifecycle handlers)
  await writeFile(path.join(state.deployPath, "deployment.json"), JSON.stringify({
    id: state.id, templateId: state.templateId, templateName: state.templateName,
    labType: state.labType, prefix: state.prefix, deployPath: state.deployPath,
    vmNames: state.vmNames, createdAt: state.createdAt,
    repoPath: repoDest, composeFile: composeRel,
  }, null, 2));

  state.phases.prepare.result = {
    repoPath: repoDest,
    composeFile: composePath,
    sarRepo: repoUrl,
  };

  log("Prepare phase complete — ready to start Docker stack");
}

async function phaseSARDocker(state: DeploymentState) {
  const log = (m: string) => logTo(state, "sar", m);

  const meta = JSON.parse(readFileSync(path.join(state.deployPath, "deployment.json"), "utf-8"));
  const repoPath = meta.repoPath || path.join(state.deployPath, "attack_range");
  const composeRel = meta.composeFile || "docker/docker-compose.yml";

  if (!existsSync(path.join(repoPath, composeRel))) {
    throw new Error("attack_range compose file missing — run prepare phase first");
  }

  // Pre-flight: verify this process can actually talk to the Docker daemon.
  // `docker info` fails fast with permission-denied when the Node process isn't
  // in the docker group, avoiding a long/cryptic `docker compose up` failure.
  try {
    await exec("docker", ["info"], { timeout: 10_000 });
    log("Docker daemon reachable");
  } catch (e: any) {
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join(" | ").slice(0, 400);
    throw new Error(
      `Cannot reach Docker daemon from this process: ${detail}. ` +
      `If you just added '${process.env.USER || "nested"}' to the 'docker' group, ` +
      `RESTART this dev server (Ctrl+C then \`npm run dev\`) — group membership doesn't apply to already-running processes.`,
    );
  }

  const compose = await resolveCompose();
  log(`Using compose command: ${compose.cmd} ${compose.baseArgs.join(" ")}`);
  log("Starting Docker stack (first run pulls images — can take several minutes)...");

  const upOk = await spawnAndWait(
    compose.cmd,
    [...compose.baseArgs, "-f", composeRel, "up", "-d"],
    repoPath,
    "docker-compose-up",
    process.env,
    log,
    10 * 60 * 1000, // 10 min for image pulls
  );
  if (!upOk) {
    throw new Error("docker compose up returned non-zero exit code — check logs above");
  }

  log("Waiting for SAR API (localhost:4000)...");
  const apiUp = await waitFor(() => checkPort("127.0.0.1", 4000), 5 * 60 * 1000, 5000, "SAR API", log);
  if (!apiUp) throw new Error("SAR API (port 4000) did not come up within 5 minutes");

  log("Waiting for SAR Web UI (localhost:4321)...");
  const webUp = await waitFor(() => checkPort("127.0.0.1", 4321), 5 * 60 * 1000, 5000, "SAR Web UI", log);
  if (!webUp) throw new Error("SAR Web UI (port 4321) did not come up within 5 minutes");

  state.phases.sar.result = {
    webUrl: "http://localhost:4321",
    apiUrl: "http://localhost:4000",
    swaggerUrl: "http://localhost:4000/openapi/swagger",
    composePath: path.join(repoPath, composeRel),
  };

  log("Docker stack up — SAR controller is ready at http://localhost:4321");
}

/**
 * Detect whether the modern `docker compose` plugin or the legacy `docker-compose`
 * binary is available, and return a command descriptor for spawning.
 */
async function resolveCompose(): Promise<{ cmd: string; baseArgs: string[] }> {
  try {
    await exec("docker", ["compose", "version"], { timeout: 5000 });
    return { cmd: "docker", baseArgs: ["compose"] };
  } catch { /* try legacy */ }
  try {
    await exec("docker-compose", ["--version"], { timeout: 5000 });
    return { cmd: "docker-compose", baseArgs: [] };
  } catch {
    throw new Error("Neither `docker compose` (plugin) nor `docker-compose` (legacy) is available");
  }
}

/**
 * Ensure docker + compose are installed. Attempts passwordless `sudo apt-get install`
 * if either is missing. Throws with a manual-install instruction string when sudo
 * requires a password or the install fails.
 */
async function ensureDocker(log: (m: string) => void): Promise<void> {
  const has = async (cmd: string, args: string[]) => {
    try { await exec(cmd, args, { timeout: 5000 }); return true; }
    catch { return false; }
  };

  const dockerOk = await has("docker", ["--version"]);
  const composeOk = (await has("docker", ["compose", "version"]))
                 || (await has("docker-compose", ["--version"]));

  // Install Docker + Compose if missing
  if (!dockerOk || !composeOk) {
    log("Docker/Compose missing — attempting passwordless sudo install (apt-get)");
    try {
      await exec("sudo", ["-n", "apt-get", "update"], { timeout: 60_000 });
      await exec("sudo", ["-n", "apt-get", "install", "-y", "docker.io", "docker-compose-plugin"], { timeout: 300_000 });
      log("Docker installed");
    } catch {
      throw new Error(
        "Cannot auto-install Docker (sudo needs password or network unavailable). " +
        "Run manually: `sudo apt-get install -y docker.io docker-compose-plugin && sudo usermod -aG docker $USER`, then log out/in.",
      );
    }
  } else {
    log("Docker + Compose already installed");
  }

  // Ensure the current user is in the `docker` group — required for daemon socket access.
  // This runs even when Docker was pre-installed (common install where group membership was skipped).
  await ensureDockerGroupMembership(log);
}

/**
 * Verify the current user belongs to the `docker` group. If not, attempt to add them
 * via passwordless sudo. Throws with clear remediation instructions when it can't.
 *
 * IMPORTANT: group changes do NOT propagate into already-running processes — the Next.js
 * dev server must be restarted before it can open /var/run/docker.sock. We surface that
 * instruction in the error message so the user knows what to do next.
 */
async function ensureDockerGroupMembership(log: (m: string) => void): Promise<void> {
  const user = process.env.USER || "nested";
  let groups: string[] = [];
  try {
    const { stdout } = await exec("id", ["-nG", user], { timeout: 5000 });
    groups = stdout.trim().split(/\s+/);
  } catch { /* best-effort */ }

  if (groups.includes("docker")) {
    log(`User '${user}' is already in the 'docker' group`);
    return;
  }

  log(`User '${user}' is NOT in the 'docker' group — adding now (requires passwordless sudo)`);
  try {
    await exec("sudo", ["-n", "usermod", "-aG", "docker", user], { timeout: 10_000 });
    log(`Added '${user}' to 'docker' group`);
  } catch {
    throw new Error(
      `User '${user}' must be in the 'docker' group to access the daemon socket. ` +
      `Run: \`sudo usermod -aG docker ${user}\`, then RESTART this dev server ` +
      `(new group membership doesn't apply to already-running processes).`,
    );
  }

  // Even after usermod succeeds, the current Node process still holds its old group list.
  // Fail early with a clear instruction instead of letting phase 1 blow up with "permission denied".
  throw new Error(
    `Added '${user}' to the 'docker' group, but this Next.js process was started BEFORE the ` +
    `change and still can't access /var/run/docker.sock. Please RESTART the dev server ` +
    `(Ctrl+C and \`npm run dev\` again) and re-run the prepare phase.`,
  );
}

// ══════════════════════════════════════════════
// Lifecycle (stop/resume/destroy)
// ══════════════════════════════════════════════

async function handleLifecycle(action: string, deployPath?: string) {
  const dp = deployPath || active?.deployPath;
  if (!dp || !existsSync(path.join(dp, "deployment.json"))) {
    return NextResponse.json({ error: "No deployment at path" }, { status: 404 });
  }

  const meta = JSON.parse(readFileSync(path.join(dp, "deployment.json"), "utf-8"));
  const sarDir = path.join(dp, "sar");
  const sarPy = path.join(sarDir, "venv", "bin", "python3");
  const sarScript = path.join(sarDir, "attack_range_local.py");
  const goadDir = path.join(dp, "goad", "provider");
  const dockerRepo = meta.repoPath || path.join(dp, "attack_range");
  const dockerCompose = meta.composeFile || "docker/docker-compose.yml";
  const results: string[] = [];

  // SAR Docker templates have their own lifecycle — handled here and we skip
  // the Vagrant-flavored branches below.
  if (meta.labType === "sar-docker") {
    const compose = await resolveCompose().catch(() => null);
    if (!compose) {
      return NextResponse.json({ error: "docker compose not available on host" }, { status: 500 });
    }
    if (action === "stop") {
      try {
        await exec(compose.cmd, [...compose.baseArgs, "-f", dockerCompose, "down"], { cwd: dockerRepo, timeout: 120_000 });
        results.push("SAR Docker stack stopped");
      } catch { results.push("docker compose down had issues"); }
    } else if (action === "resume") {
      try {
        await exec(compose.cmd, [...compose.baseArgs, "-f", dockerCompose, "up", "-d"], { cwd: dockerRepo, timeout: 300_000 });
        results.push("SAR Docker stack resumed");
      } catch { results.push("docker compose up had issues"); }
    } else if (action === "destroy") {
      try {
        await exec(compose.cmd, [...compose.baseArgs, "-f", dockerCompose, "down", "-v"], { cwd: dockerRepo, timeout: 120_000 });
        results.push("SAR Docker stack destroyed (volumes removed)");
      } catch { results.push("docker compose down -v had issues"); }
      try {
        await rm(dp, { recursive: true, force: true });
        results.push("Deploy directory removed");
      } catch { results.push("deploy dir removal had issues"); }
      unregisterDeployment(dp);
      results.push("Removed from deployment registry");
    } else {
      return NextResponse.json({ error: "action must be stop|resume|destroy" }, { status: 400 });
    }
    return NextResponse.json({ success: true, action, deployPath: dp, results });
  }

  if (action === "stop") {
    if (existsSync(sarPy) && existsSync(sarScript)) {
      try {
        await exec(sarPy, [sarScript, "-a", "stop"], {
          cwd: sarDir, timeout: 120000,
          env: { ...process.env, PATH: `${path.join(sarDir, "venv", "bin")}:${process.env.PATH}` },
        });
        results.push("SAR stopped");
      } catch { results.push("SAR stop had issues"); }
    }
    if (meta.labType === "sar-goad" && existsSync(goadDir)) {
      try { await exec("vagrant", ["halt"], { cwd: goadDir, timeout: 120000 }); results.push("GOAD stopped"); }
      catch { results.push("GOAD halt had issues"); }
    }
    // Authoritative stop: power off the deploy's VMs by their known (prefixed)
    // names. SAR/vagrant `-a stop` manages names it may not know, so this is what
    // actually guarantees the lab server halts.
    for (const vm of vmNamesOf(meta)) {
      try {
        const { stdout } = await exec("VBoxManage", ["showvminfo", vm, "--machinereadable"], { timeout: 8000 });
        if (stdout.includes('VMState="running"')) {
          await exec("VBoxManage", ["controlvm", vm, "poweroff"], { timeout: 20000 });
          results.push(`Powered off ${vm}`);
        } else {
          results.push(`${vm} already stopped`);
        }
      } catch { /* not registered / already gone */ }
    }
  } else if (action === "resume") {
    if (existsSync(sarPy) && existsSync(sarScript)) {
      try {
        await exec(sarPy, [sarScript, "-a", "resume"], {
          cwd: sarDir, timeout: 300000,
          env: { ...process.env, PATH: `${path.join(sarDir, "venv", "bin")}:${process.env.PATH}` },
        });
        results.push("SAR resumed");
      } catch { results.push("SAR resume had issues"); }
    }
    if (meta.labType === "sar-goad" && existsSync(goadDir)) {
      try { await exec("vagrant", ["up"], { cwd: goadDir, timeout: 300000 }); results.push("GOAD resumed"); }
      catch { results.push("GOAD resume had issues"); }
    }
    // Authoritative start: boot the deploy's VMs by name (headless) if not up.
    for (const vm of vmNamesOf(meta)) {
      try {
        const { stdout } = await exec("VBoxManage", ["showvminfo", vm, "--machinereadable"], { timeout: 8000 });
        if (!stdout.includes('VMState="running"')) {
          await exec("VBoxManage", ["startvm", vm, "--type", "headless"], { timeout: 90000 });
          results.push(`Started ${vm}`);
        } else {
          results.push(`${vm} already running`);
        }
      } catch { /* not registered */ }
    }
  } else if (action === "destroy") {
    if (existsSync(sarPy) && existsSync(sarScript)) {
      try {
        await exec(sarPy, [sarScript, "-a", "destroy"], {
          cwd: sarDir, timeout: 120000,
          env: { ...process.env, PATH: `${path.join(sarDir, "venv", "bin")}:${process.env.PATH}` },
        });
        results.push("SAR destroyed");
      } catch { results.push("SAR destroy had issues"); }
    }
    if (meta.labType === "sar-goad" && existsSync(goadDir)) {
      try { await exec("vagrant", ["destroy", "-f"], { cwd: goadDir, timeout: 120000 }); results.push("GOAD destroyed"); }
      catch { results.push("GOAD destroy had issues"); }
    }
    // Authoritative destroy: power off + unregister-delete the deploy's VMs by
    // name, so a lab whose SAR/vagrant state is stale is still fully removed.
    for (const vm of vmNamesOf(meta)) {
      try {
        const { stdout } = await exec("VBoxManage", ["showvminfo", vm, "--machinereadable"], { timeout: 8000 });
        if (stdout.includes('VMState="running"')) await exec("VBoxManage", ["controlvm", vm, "poweroff"], { timeout: 20000 }).catch(() => {});
        await exec("VBoxManage", ["unregistervm", vm, "--delete"], { timeout: 90000 });
        results.push(`Removed VM ${vm}`);
      } catch { /* already gone / not registered */ }
    }
    // Remove from global registry so it no longer appears in Detected Environments
    unregisterDeployment(dp);
    results.push("Removed from deployment registry");
  } else {
    return NextResponse.json({ error: "action must be stop|resume|destroy" }, { status: 400 });
  }

  return NextResponse.json({ success: true, action, deployPath: dp, results });
}

// ══════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** The VirtualBox VM names a deploy owns (from deployment.json's vmNames map). */
function vmNamesOf(meta: any): string[] {
  const names = meta?.vmNames && typeof meta.vmNames === "object" ? Object.values(meta.vmNames) : [];
  return names.filter((n): n is string => typeof n === "string" && n.length > 0);
}

async function pingHost(ip: string): Promise<boolean> {
  try { const { stdout } = await exec("ping", ["-c", "1", "-W", "2", ip], { timeout: 5000 }); return stdout.includes("1 received"); }
  catch { return false; }
}

async function checkPort(ip: string, port: number): Promise<boolean> {
  try { await exec("bash", ["-c", `echo >/dev/tcp/${ip}/${port}`], { timeout: 5000 }); return true; }
  catch { return false; }
}

/** Poll a check function until it returns true or timeout. Logs progress every N attempts. */
async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  label: string,
  log: (m: string) => void,
): Promise<boolean> {
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    attempts++;
    if (await check()) {
      log(`  ${label}: OK after ${Math.round((Date.now() - start) / 1000)}s`);
      return true;
    }
    if (attempts % 6 === 0) {
      log(`  ${label}: still waiting (${Math.round((Date.now() - start) / 1000)}s elapsed)...`);
    }
    await sleep(intervalMs);
  }
  log(`  ${label}: TIMEOUT after ${Math.round(timeoutMs / 1000)}s`);
  return false;
}

async function stopConflictingVMs(vmNames: Record<string, string>, log: (m: string) => void) {
  // Stop the original VMs (DC01, WS01, attack-range-*) so they don't hold resources
  const conflictNames = ["DC01", "WS01", "attack-range-splunk-server", "attack-range-windows-domain-controller"];
  for (const vm of conflictNames) {
    try {
      const { stdout } = await exec("VBoxManage", ["showvminfo", vm, "--machinereadable"], { timeout: 5000 });
      if (stdout.includes('VMState="running"')) {
        await exec("VBoxManage", ["controlvm", vm, "poweroff"], { timeout: 15000 });
        log(`  Powered off conflicting VM: ${vm}`);
      }
    } catch { /* not registered */ }
  }
  // Also check that our prefixed names don't already exist
  try {
    const { stdout } = await exec("VBoxManage", ["list", "vms"], { timeout: 10000 });
    const existing = stdout.split("\n").map((l) => l.match(/"([^"]+)"/)?.[1]).filter(Boolean);
    const conflicts = Object.values(vmNames).filter((n) => existing.includes(n));
    if (conflicts.length > 0) {
      throw new Error(`Prefixed VM names already exist: ${conflicts.join(", ")} — collision in deployment ID`);
    }
  } catch (e: any) {
    if (e.message?.includes("collision")) throw e;
  }
}

async function setVBoxFolder(dir: string, log: (m: string) => void): Promise<string> {
  try {
    const { stdout } = await exec("VBoxManage", ["list", "systemproperties"], { timeout: 5000 });
    const orig = stdout.match(/Default machine folder:\s+(.+)/)?.[1]?.trim() || "";
    await exec("VBoxManage", ["setproperty", "machinefolder", dir], { timeout: 5000 });
    log(`VBox machine folder → ${dir}`);
    return orig;
  } catch { return ""; }
}

async function restoreVBoxFolder(orig: string) {
  if (!orig) return;
  try { await exec("VBoxManage", ["setproperty", "machinefolder", orig], { timeout: 5000 }); } catch {}
}

function spawnAndWait(
  cmd: string, args: string[], cwd: string, label: string, env: any,
  log: (m: string) => void, timeoutMs: number,
  logFilePath?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    // Force line-buffered output from Python-based tooling (attack_range_local.py
    // block-buffers by default when stdout isn't a TTY, so on a fast failure its
    // output would otherwise be lost). Harmless for non-Python commands.
    const childEnv = { PYTHONUNBUFFERED: "1", ...env };
    const child = nodeSpawn(cmd, args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });

    // Full, untruncated output is written to logFilePath; a rolling tail is kept
    // in memory to surface on failure.
    const tail: string[] = [];
    if (logFilePath) {
      try { writeFileSync(logFilePath, `$ ${cmd} ${args.join(" ")}\n[cwd] ${cwd}\n\n`); } catch { /* best-effort */ }
    }

    const onData = (data: Buffer) => {
      const text = data.toString();
      if (logFilePath) { try { appendFileSync(logFilePath, text); } catch { /* best-effort */ } }
      for (const l of text.split("\n")) {
        if (!l.trim()) continue;
        // Don't truncate ansible "fatal:"/"FAILED!" lines — they carry the real error.
        const c = l.includes("fatal:") || l.includes("FAILED!") ? l : l.slice(0, 500);
        tail.push(c);
        if (tail.length > 200) tail.shift();
        // Stream EVERY line to the UI so the user sees the full build log live.
        log(`  ${label}: ${c}`);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const finishTimedOut = () => {
      log(`  ${label}: TIMEOUT after ${Math.round(timeoutMs / 60000)} min`);
      if (logFilePath) log(`  ${label}: full build log → ${logFilePath}`);
    };

    const timeout = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      finishTimedOut();
      resolve(false);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        log(`  ${label}: exit code ${code}`);
        if (tail.length === 0) {
          log(`  ${label}: (the command produced no output before exiting — check that ${cmd} runs, and VirtualBox/Vagrant are healthy)`);
        } else {
          log(`  ${label}: ---- last ${Math.min(40, tail.length)} lines ----`);
          for (const l of tail.slice(-40)) log(`  ${label} | ${l}`);
        }
        if (logFilePath) log(`  ${label}: full build log → ${logFilePath}`);
      }
      resolve(code === 0);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      log(`  ${label}: spawn error: ${err.message}`);
      if (logFilePath) log(`  ${label}: full build log → ${logFilePath}`);
      resolve(false);
    });
  });
}

/**
 * Apply the deploy's `config` customization to the copied attack_range_local.conf:
 *   - vmToggles:  which VMs to build (e.g. splunk_server=1, windows_client=1,
 *                 windows_domain_controller=0) — so a "Splunk + workstation" lab
 *                 builds without a DC.
 *   - resources:  per-VM { memory, cpus } → `<key>_memory` / `<key>_cpus`.
 *   - splunk_admin_password, win_password.
 *   - networkBase: rebase every `*_private_ip = 10.0.1.X` to `<base>.X` (e.g.
 *                  "192.168.56") so the lab lives on a network your fleet reaches.
 * Splunk Web/mgmt already bind 0.0.0.0 in SAR, so no bind patch is needed.
 * Every key is optional — absent config leaves the SAR defaults untouched.
 */
function patchSARConf(sarDest: string, state: DeploymentState, log: (m: string) => void) {
  const confPath = path.join(sarDest, "attack_range_local.conf");
  if (!existsSync(confPath)) { log("  attack_range_local.conf not found — skipping conf patch"); return; }
  const cfg = state.config || {};
  let conf = readFileSync(confPath, "utf-8");
  const setKey = (key: string, value: string | number) => {
    const re = new RegExp(`^(${key}\\s*=\\s*).*$`, "m");
    if (re.test(conf)) { conf = conf.replace(re, `$1${value}`); return true; }
    return false;
  };

  // Enabled VMs
  const toggles = (cfg.vmToggles || {}) as Record<string, number | boolean>;
  for (const [k, v] of Object.entries(toggles)) {
    if (setKey(k, v ? 1 : 0)) log(`  conf: ${k} = ${v ? 1 : 0}`);
  }
  // Per-VM resources
  const resources = (cfg.resources || {}) as Record<string, { memory?: number; cpus?: number }>;
  for (const [vm, r] of Object.entries(resources)) {
    if (r?.memory) setKey(`${vm}_memory`, Math.round(r.memory));
    if (r?.cpus) setKey(`${vm}_cpus`, Math.round(r.cpus));
  }
  // Credentials
  if (cfg.splunk_admin_password) setKey("splunk_admin_password", String(cfg.splunk_admin_password));
  if (cfg.win_password) setKey("win_password", String(cfg.win_password));
  // Network rebase (host octet preserved)
  const base = typeof cfg.networkBase === "string" && /^\d+\.\d+\.\d+$/.test(cfg.networkBase) ? cfg.networkBase : "";
  if (base && base !== "10.0.1") {
    conf = conf.replace(/(_private_ip\s*=\s*)10\.0\.1\.(\d+)/g, `$1${base}.$2`);
    log(`  conf: rebased private IPs 10.0.1.x → ${base}.x`);
  }
  writeFileSync(confPath, conf);
  log("  Patched attack_range_local.conf with deploy customization");
}

function patchSARVagrantfile(
  sarDest: string, prefix: string, vmNames: Record<string, string>, log: (m: string) => void,
) {
  // IMPORTANT: SAR's attack_range_local.py regenerates vagrant/Vagrantfile from
  // the per-VM templates in vagrant/<vm>/Vagrantfile via VagrantController.py
  // every time `-a build` runs. Patching only vagrant/Vagrantfile is useless
  // because it gets overwritten. We must patch the per-VM TEMPLATES instead.

  const replaceInFile = (file: string) => {
    if (!existsSync(file)) return;
    let vf = readFileSync(file, "utf-8");
    const before = vf;
    vf = vf.replace(/attack-range-splunk-server/g, vmNames["splunk-server"] || `${prefix}-splunk-server`);
    vf = vf.replace(/attack-range-windows-domain-controller/g, vmNames["windows-dc"] || `${prefix}-windows-dc`);
    vf = vf.replace(/attack-range-windows-server/g, `${prefix}-windows-server`);
    vf = vf.replace(/attack-range-phantom-server/g, `${prefix}-phantom-server`);
    vf = vf.replace(/attack-range-caldera-server/g, `${prefix}-caldera-server`);
    vf = vf.replace(/attack-range-kali/g, `${prefix}-kali`);
    vf = vf.replace(/attack-range-windows-10/g, `${prefix}-windows-10`);
    // FORCE HEADLESS — no GUI, no interactive popups, no manual reboot prompts.
    // SAR templates default to vb.gui = true which shows a window the user has
    // to click on. We override that here.
    vf = vf.replace(/vb\.gui\s*=\s*true/g, "vb.gui = false");
    // Auto-correct port forwarding to avoid host port collisions
    vf = vf.split("\n").map((line) => {
      if (line.includes("forwarded_port") && !line.includes("auto_correct")) {
        return line.trimEnd() + (line.trimEnd().endsWith(",") ? " auto_correct: true" : ", auto_correct: true");
      }
      return line;
    }).join("\n");
    if (vf !== before) writeFileSync(file, vf);
  };

  const vagrantDir = path.join(sarDest, "vagrant");
  // Per-VM templates that SAR concatenates into the master Vagrantfile
  const templates = [
    "splunk_server/Vagrantfile",
    "windows-domain-controller/Vagrantfile",
    "windows-server/Vagrantfile",
    "phantom-server/Vagrantfile",
    "caldera-server/Vagrantfile",
    "kali-machine/Vagrantfile",
    "windows10/Vagrantfile",
  ];
  let patched = 0;
  for (const t of templates) {
    const p = path.join(vagrantDir, t);
    if (existsSync(p)) { replaceInFile(p); patched++; }
  }
  // Also patch the master Vagrantfile (in case build is skipped or for first reference)
  replaceInFile(path.join(vagrantDir, "Vagrantfile"));
  log(`SAR per-VM templates patched (${patched} files) — names will survive SAR regeneration`);
}

async function prepareGOAD(
  goadDest: string, prefix: string, vmNames: Record<string, string>, log: (m: string) => void,
) {
  mkdirSync(goadDest, { recursive: true });

  const instProvider = path.join(GOAD_SOURCE, "workspace", "d86a4c-minilab-virtualbox", "provider");
  if (!existsSync(instProvider)) throw new Error(`GOAD instance provider not found: ${instProvider}`);

  const dest = path.join(goadDest, "provider");
  mkdirSync(dest, { recursive: true });
  await exec("bash", ["-c", `cp -a "${instProvider}/"* "${dest}/" 2>/dev/null; rm -rf "${dest}/.vagrant"`], { timeout: 30000 });

  // vagrant scripts (Install-WMF3Hotfix.ps1, ConfigureRemotingForAnsible.ps1, fix_ip.ps1)
  const vagrantScripts = path.join(GOAD_SOURCE, "vagrant");
  if (existsSync(vagrantScripts)) {
    await exec("bash", ["-c", `cp -a "${vagrantScripts}" "${path.join(goadDest, "vagrant")}"`], { timeout: 30000 });
  }

  // Splunk Forwarder extension
  const extSrc = path.join(GOAD_SOURCE, "extensions", "splunk_forwarder");
  if (existsSync(extSrc)) {
    const extDest = path.join(goadDest, "extensions", "splunk_forwarder");
    mkdirSync(path.dirname(extDest), { recursive: true });
    await exec("bash", ["-c", `cp -a "${extSrc}" "${extDest}"`], { timeout: 30000 });
  }

  // AD lab data (config.json, inventory template) — required by GOAD ansible playbooks
  const adSrc = path.join(GOAD_SOURCE, "ad", "MINILAB");
  if (existsSync(adSrc)) {
    const adDest = path.join(goadDest, "ad", "MINILAB");
    mkdirSync(path.dirname(adDest), { recursive: true });
    await exec("bash", ["-c", `cp -a "${adSrc}" "${adDest}"`], { timeout: 30000 });
    log("Copied ad/MINILAB lab definition");
  } else {
    throw new Error(`GOAD ad/MINILAB not found at ${adSrc}`);
  }

  // GOAD ansible playbooks (build.yml, ad-servers.yml, ad-parent_domain.yml, etc.)
  const ansibleSrc = path.join(GOAD_SOURCE, "ansible");
  if (existsSync(ansibleSrc)) {
    const ansibleDest = path.join(goadDest, "ansible");
    await exec("bash", ["-c", `cp -a "${ansibleSrc}" "${ansibleDest}"`], { timeout: 60000 });
    log("Copied GOAD ansible playbooks");
    // Note: common/main.yml and domain_controller/main.yml are patched later in
    // runGOADProvisioning() (Phase 2) so they always start from a clean source copy.
  } else {
    throw new Error(`GOAD ansible directory not found at ${ansibleSrc}`);
  }

  // playbooks.yml — has the playbook order config
  const playbooksYml = path.join(GOAD_SOURCE, "playbooks.yml");
  if (existsSync(playbooksYml)) {
    await exec("bash", ["-c", `cp "${playbooksYml}" "${goadDest}/playbooks.yml"`], { timeout: 5000 });
  }

  // globalsettings.ini — third inventory file that GOAD always loads. Provides
  // keyboard_layouts, add_route, route_gateway, route_network, enable_http_proxy,
  // ad_http_proxy, etc. Without this, build.yml fails on undefined vars.
  const globalSettings = path.join(GOAD_SOURCE, "globalsettings.ini");
  if (existsSync(globalSettings)) {
    await exec("bash", ["-c", `cp "${globalSettings}" "${goadDest}/globalsettings.ini"`], { timeout: 5000 });
    log("Copied globalsettings.ini (provides keyboard_layouts, add_route, etc.)");
  } else {
    log("WARNING: globalsettings.ini not found in GOAD source — playbooks may fail on undefined vars");
  }

  const goadVf = path.join(dest, "Vagrantfile");
  if (!existsSync(goadVf)) throw new Error("GOAD Vagrantfile missing after copy");

  let vf = readFileSync(goadVf, "utf-8");
  vf = vf.replace(/\.\.\/\.\.\/\.\.\/vagrant\//g, "../vagrant/");
  vf = vf.replace(/:name => "DC01"/g, `:name => "${vmNames["DC01"] || `${prefix}-DC01`}"`);
  vf = vf.replace(/:name => "WS01"/g, `:name => "${vmNames["WS01"] || `${prefix}-WS01`}"`);
  vf = vf.replace(/\/GOAD/g, `/${prefix}`);
  // FORCE HEADLESS — GOAD's default Vagrantfile uses GUI mode (no explicit gui flag,
  // VirtualBox provider defaults to GUI). We inject vb.gui = false in the provider block
  // so no Windows interactive popups appear during boot/provisioning.
  // The provider block looks like: target.vm.provider "virtualbox" do |v|
  vf = vf.replace(
    /(target\.vm\.provider\s+"virtualbox"\s+do\s+\|v\|\s*\n)/,
    "$1        v.gui = false\n"
  );
  writeFileSync(goadVf, vf);
  log("GOAD Vagrantfile patched (relative paths + unique names + headless mode)");
}

/**
 * Run GOAD AD provisioning playbooks against the booted VMs.
 * This is what actually:
 *   1. Promotes DC01 to a domain controller (mini.lab)
 *   2. Joins WS01 to the domain
 *   3. Sets up users, groups, OUs
 *
 * Uses the merged inventory (lab template + per-instance) the same way GOAD CLI does.
 * Runs against vagrant credentials (winrm vagrant/vagrant) since this is fresh.
 */
async function runGOADProvisioning(
  goadDest: string, log: (m: string) => void,
): Promise<{ success: boolean; error?: string; playbooksRun: string[] }> {
  const home = process.env.HOME || "/root";
  const ansibleBin = `${home}/.goad/.venv/bin/ansible-playbook`;

  if (!existsSync(ansibleBin)) {
    return { success: false, error: "GOAD ansible venv not found at ~/.goad/.venv", playbooksRun: [] };
  }

  const ansibleDir = path.join(goadDest, "ansible");
  if (!existsSync(ansibleDir)) {
    return { success: false, error: `GOAD ansible directory missing: ${ansibleDir}`, playbooksRun: [] };
  }

  // ─── ROOT CAUSE & FIX ─────────────────────────────────────────────────────
  //
  // GOAD's stock common role tries to install ComputerManagementDsc and xNetworking
  // PowerShell modules via Install-PackageProvider / Install-Module / win_psmodule.
  //
  // On a fresh Windows Server 2019 GOAD box, this fails because:
  //   1. The stock PowerShellGet 1.0.0.1 needs to download a newer NuGet provider
  //      from onegetcdn.azureedge.net before it can do anything else.
  //   2. The Azure Edge CDN cert chain is NOT trusted by the box's stale root CA store.
  //   3. Manual download via Invoke-WebRequest also fails on the same TLS cert issue.
  //   4. Even Save-Module fails on the FIRST call because it needs NuGet, which
  //      triggers an interactive ShouldContinue prompt — and Ansible runs PowerShell
  //      in NonInteractive mode, so the prompt errors out.
  //
  // The user's local install works because the modules are ALREADY present from a
  // prior manual interactive run. On a fresh deploy they're not.
  //
  // SOLUTION (verified end-to-end against the actual GOAD DC01 VM):
  //   - Cache the .nupkg files (which are just .zip archives) on the host where
  //     curl/Linux TLS works fine.
  //   - Push the extracted module folders directly to the GOAD VMs via win_copy
  //     into C:\Program Files\WindowsPowerShell\Modules\<Name>\<Version>\
  //   - That's the system PSModulePath — Get-Module -ListAvailable picks them up
  //     and DSC resources (xFirewall, etc.) load correctly.
  //   - Patch common/main.yml to skip the broken Install-PackageProvider/win_psmodule
  //     tasks since the modules are already present.
  // ──────────────────────────────────────────────────────────────────────────

  // Step A: ensure module cache exists on host (downloads + extracts on first run)
  const moduleCache = path.join(process.cwd(), "labs", ".cache", "goad-modules");
  await ensureModuleCache(moduleCache, log);

  // Step B: push cached modules to both GOAD VMs via Ansible win_copy.
  // This must happen BEFORE running build.yml so the modules are present when
  // the (patched) common role runs.
  const pushOk = await pushModulesToGOADVMs(moduleCache, ansibleBin, log);
  if (!pushOk) {
    return { success: false, error: "Failed to push pre-built PowerShell modules to GOAD VMs", playbooksRun: [] };
  }

  // Step C: patch common/main.yml to skip the broken Install-Module tasks.
  //
  // CRITICAL: always restore the ORIGINAL common/main.yml from the GOAD source
  // first, so retries (and old patches from previous runs) don't compound.
  const commonMainYml = path.join(ansibleDir, "roles", "common", "tasks", "main.yml");
  const originalCommonMainYml = path.join(GOAD_SOURCE, "ansible", "roles", "common", "tasks", "main.yml");

  if (existsSync(originalCommonMainYml)) {
    // Always start fresh — copy the original GOAD common/main.yml over any
    // previously-patched version so we can re-apply the patch from a clean state.
    await exec("cp", ["-f", originalCommonMainYml, commonMainYml], { timeout: 5000 });
    log("  Restored original common/main.yml from GOAD source (idempotent re-patch)");
  }

  if (existsSync(commonMainYml)) {
    const common = readFileSync(commonMainYml, "utf-8");
    // Build replacement: skip Install-Module entirely (modules pre-pushed),
    // keep RDP enable + firewall rule, drop add_route (vars not loaded).
    const replacement = `# DETECTION_PLATFORM_PATCHED_V4 — modules pre-pushed from host (Linux TLS works,
# stock W2019 cert chain doesn't trust Azure Edge CDN). The stock Install-Module /
# win_psmodule tasks that follow this comment in vanilla GOAD are intentionally removed.
- name: "Verify pre-installed PowerShell modules (pushed from host)"
  win_shell: |
    $ProgressPreference = 'SilentlyContinue'
    $cm = Get-Module -ListAvailable ComputerManagementDsc | Select-Object -First 1
    $xn = Get-Module -ListAvailable xNetworking | Select-Object -First 1
    if (-not $cm) { throw "ComputerManagementDsc not found in PSModulePath — host push failed" }
    if (-not $xn) { throw "xNetworking not found in PSModulePath — host push failed" }
    "ComputerManagementDsc=$($cm.Version) xNetworking=$($xn.Version)"

- name: Windows | Enable Remote Desktop
  win_dsc:
    resource_name: RemoteDesktopAdmin
    IsSingleInstance: 'yes'
    Ensure: present
    UserAuthentication: Secure

- name: Firewall | Allow RDP through Firewall
  win_dsc:
    resource_name: xFirewall
    Name: "Administrator access for RDP (TCP-In)"
    Ensure: present
    Enabled: True
    Profile: "Domain"
    Direction: "Inbound"
    Localport: "3389"
    Protocol: "TCP"
    Description: "Opens the listener port for RDP"

- name: Add a network static route
  community.windows.win_route:
    destination: "{{route_network}}"
    gateway: "{{route_gateway}}"
    metric: 1
    state: present
  when: add_route == "yes"
`;

    const upgradeMarker = "- name: Upgrade module PowerShellGet";
    const idx = common.indexOf(upgradeMarker);
    if (idx > 0) {
      const newCommon = common.slice(0, idx) + replacement;
      writeFileSync(commonMainYml, newCommon);
      log("  Patched common/main.yml: removed broken module install + add_route (modules pre-pushed)");
    } else {
      // Original GOAD file should always have this marker — if missing, the GOAD source changed
      log("  WARNING: PowerShellGet upgrade marker not found in original GOAD common/main.yml");
    }
  }

  // ─── Patch domain_controller/main.yml ───
  // Same fix as common role: replace `win_psmodule: xDnsServer` (which calls
  // Install-Module -AcceptLicense and fails on stock W2019) with a verify-only
  // step. The xDnsServer module was pre-pushed to PSModulePath in pushModulesToGOADVMs.
  const dcMainYml = path.join(ansibleDir, "roles", "domain_controller", "tasks", "main.yml");
  const originalDcMainYml = path.join(GOAD_SOURCE, "ansible", "roles", "domain_controller", "tasks", "main.yml");

  if (existsSync(originalDcMainYml)) {
    // Always restore from source first (idempotent re-patch on retries)
    await exec("cp", ["-f", originalDcMainYml, dcMainYml], { timeout: 5000 });
    log("  Restored original domain_controller/main.yml from GOAD source");
  }

  if (existsSync(dcMainYml)) {
    let dc = readFileSync(dcMainYml, "utf-8");

    // Replace BOTH win_psmodule tasks in the dc role (xDnsServer and ActiveDirectoryDSC)
    // with verify-only win_shell steps. The modules are pre-pushed to PSModulePath in
    // pushModulesToGOADVMs, so we just confirm they're present.
    const dcXDnsReplacement = `- name: "Verify xDnsServer module is present (pushed from host)"
  win_shell: |
    $ProgressPreference = 'SilentlyContinue'
    $xd = Get-Module -ListAvailable xDnsServer | Select-Object -First 1
    if (-not $xd) { throw "xDnsServer not found in PSModulePath — host push failed" }
    "xDnsServer=$($xd.Version)"
  changed_when: false
`;

    const dcAdDscReplacement = `- name: "Verify ActiveDirectoryDsc module is present (pushed from host)"
  win_shell: |
    $ProgressPreference = 'SilentlyContinue'
    $ad = Get-Module -ListAvailable ActiveDirectoryDsc | Select-Object -First 1
    if (-not $ad) { throw "ActiveDirectoryDsc not found in PSModulePath — host push failed" }
    "ActiveDirectoryDsc=$($ad.Version)"
  changed_when: false
`;

    let patchedDc = dc;

    // 1. xDnsServer
    const afterXDns = patchedDc.replace(
      /- name: Check for xDnsServer Powershell module\s*\n[ \t]+win_psmodule:\s*\n[ \t]+name: xDnsServer\s*\n[ \t]+state: present\s*\n/,
      dcXDnsReplacement,
    );
    if (afterXDns !== patchedDc) {
      patchedDc = afterXDns;
      log("  Patched domain_controller/main.yml: xDnsServer win_psmodule → verify-only");
    } else {
      log("  WARNING: xDnsServer win_psmodule task not found in dc role");
    }

    // 2. ActiveDirectoryDSC (note uppercase DSC in the GOAD source name field)
    const afterAd = patchedDc.replace(
      /- name: "?Install XactiveDirectory"?\s*\n[ \t]+win_psmodule:\s*\n[ \t]+name: ActiveDirectoryDSC\s*\n[ \t]+state: present\s*\n/,
      dcAdDscReplacement,
    );
    if (afterAd !== patchedDc) {
      patchedDc = afterAd;
      log("  Patched domain_controller/main.yml: ActiveDirectoryDSC win_psmodule → verify-only");
    } else {
      log("  WARNING: ActiveDirectoryDSC win_psmodule task not found in dc role");
    }

    writeFileSync(dcMainYml, patchedDc);
  }

  // Lab inventory template (has [parent_dc], [domain], [workstation] groups + auth vars)
  const labInventory = path.join(goadDest, "ad", "MINILAB", "data", "inventory");
  if (!existsSync(labInventory)) {
    return { success: false, error: `MINILAB inventory missing: ${labInventory}`, playbooksRun: [] };
  }

  // Global inventory — provides keyboard_layouts, add_route, route_gateway, etc.
  // GOAD's own provisioner always loads this as a third inventory file.
  const globalInventory = path.join(goadDest, "globalsettings.ini");
  if (!existsSync(globalInventory)) {
    return { success: false, error: `globalsettings.ini missing at ${globalInventory}`, playbooksRun: [] };
  }

  // Per-instance inventory (has actual IPs for dc01/ws01)
  // Build it fresh — uses vagrant winrm credentials so the playbooks can authenticate
  const instInvPath = path.join(goadDest, "instance_inventory");
  const instInv = [
    "[default]",
    "; ansible_host MUST be IPv4 for DNS to work",
    "dc01 ansible_host=10.0.1.30 dns_domain=dc01 dict_key=dc01",
    "ws01 ansible_host=10.0.1.31 dns_domain=dc01 dict_key=ws01",
  ].join("\n");
  writeFileSync(instInvPath, instInv);

  // Minimal MINILAB playbook sequence:
  //   build.yml          — base setup, common role, settings
  //   ad-servers.yml     — set admin password, hostname
  //   ad-parent_domain.yml — promote DC01 to domain controller (mini.lab)
  //   ad-data.yml        — create users, groups, OUs from MINILAB config.json
  //   ad-members.yml     — join WS01 to mini.lab domain
  const playbooks = [
    "build.yml",
    "ad-servers.yml",
    "ad-parent_domain.yml",
    "ad-data.yml",
    "ad-members.yml",
  ];

  const playbooksRun: string[] = [];

  for (const pb of playbooks) {
    const pbPath = path.join(ansibleDir, pb);
    if (!existsSync(pbPath)) {
      log(`  Skipping ${pb} (not found)`);
      continue;
    }

    log(`  ─── Running ${pb} ───`);
    const ok = await spawnAndWait(
      ansibleBin,
      ["-i", labInventory, "-i", instInvPath, "-i", globalInventory, pb],
      ansibleDir, `goad-${pb}`,
      { ...process.env, ANSIBLE_HOST_KEY_CHECKING: "False" },
      log, 20 * 60 * 1000,
    );

    if (!ok) {
      return {
        success: false,
        error: `Playbook ${pb} failed — see logs above`,
        playbooksRun,
      };
    }
    playbooksRun.push(pb);
    log(`  ✓ ${pb} completed`);
  }

  // Cleanup
  try { await rm(instInvPath, { force: true }); } catch {}
  return { success: true, playbooksRun };
}

async function installForwarder(
  host: string, ip: string, goadDest: string, log: (m: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const home = process.env.HOME || "/root";
  const ansibleBin = `${home}/.goad/.venv/bin/ansible-playbook`;
  const playbookDir = path.join(goadDest, "extensions", "splunk_forwarder", "ansible");

  if (!existsSync(ansibleBin)) return { success: false, error: "GOAD ansible venv not found at ~/.goad/.venv" };
  if (!existsSync(path.join(playbookDir, "install.yml"))) {
    return { success: false, error: `Playbook not found at ${playbookDir}/install.yml` };
  }

  // Build inventory file (avoid bracket-colon literal that breaks Tailwind scanner)
  const hdr = "[" + "all" + ":" + "vars" + "]";
  const inv = [
    hdr,
    "ansible_user=administrator@mini.lab",
    "ansible_password=8dCT-DJjgScp",
    "ansible_connection=winrm",
    "ansible_winrm_transport=ntlm",
    "ansible_port=5985",
    "ansible_winrm_scheme=http",
    "ansible_winrm_server_cert_validation=ignore",
    "ansible_winrm_operation_timeout_sec=400",
    "ansible_winrm_read_timeout_sec=500",
    "",
    "[splunk_forwarder_targets]",
    `${host} ansible_host=${ip}`,
    "[sysmon_targets]",
    `${host} ansible_host=${ip}`,
  ].join("\n");

  const invPath = `/tmp/deploy_${host}_${Date.now()}.ini`;
  await writeFile(invPath, inv);

  try {
    const ok = await spawnAndWait(
      ansibleBin,
      [
        "-i", invPath, path.join(playbookDir, "install.yml"),
        "--extra-vars",
        "splunk_server_ip=10.0.1.12 splunk_server_port=9997 splunk_server_mgmt_port=8089 splunk_uf_password=I-l1ke-Attack-Range! sysmon_download_url=https://download.sysinternals.com/files/Sysmon.zip",
        "-v",
      ],
      playbookDir, `forwarder-${host}`,
      { ...process.env, ANSIBLE_HOST_KEY_CHECKING: "False" },
      log, 10 * 60 * 1000,
    );
    await rm(invPath, { force: true });
    return ok ? { success: true } : { success: false, error: "ansible-playbook returned non-zero" };
  } catch (err: any) {
    await rm(invPath, { force: true });
    return { success: false, error: err.message?.slice(0, 200) };
  }
}

// ══════════════════════════════════════════════
// GOAD module cache (downloads + extracts on host where TLS works)
// ══════════════════════════════════════════════

/**
 * Ensures the GOAD PowerShell module cache exists at <project>/labs/.cache/goad-modules/.
 * Downloads ComputerManagementDsc and xNetworking from PSGallery (which works from
 * Linux host where modern TLS / cert chain is correct, unlike stock W2019) and
 * extracts them as proper module folders ready to be pushed to GOAD VMs.
 */
async function ensureModuleCache(cacheDir: string, log: (m: string) => void): Promise<void> {
  const cmDir = path.join(cacheDir, "ComputerManagementDsc");
  const xnDir = path.join(cacheDir, "xNetworking");
  const xdDir = path.join(cacheDir, "xDnsServer");
  const adDir = path.join(cacheDir, "ActiveDirectoryDsc");

  if (existsSync(cmDir) && existsSync(xnDir) && existsSync(xdDir) && existsSync(adDir)) {
    log(`  GOAD module cache already exists at ${cacheDir}`);
    return;
  }

  log(`  Downloading GOAD PowerShell modules to ${cacheDir}...`);
  mkdirSync(cacheDir, { recursive: true });

  const downloads = [
    {
      name: "ComputerManagementDsc",
      version: "10.0.0",
      url: "https://www.powershellgallery.com/api/v2/package/ComputerManagementDsc/10.0.0",
    },
    {
      name: "xNetworking",
      version: "5.7.0.0",
      url: "https://www.powershellgallery.com/api/v2/package/xNetworking/5.7.0.0",
    },
    {
      name: "xDnsServer",
      version: "1.16.0.0",
      url: "https://www.powershellgallery.com/api/v2/package/xDnsServer/1.16.0.0",
    },
    {
      name: "ActiveDirectoryDsc",
      version: "6.6.0",
      url: "https://www.powershellgallery.com/api/v2/package/ActiveDirectoryDsc/6.6.0",
    },
  ];

  for (const dl of downloads) {
    const targetDir = path.join(cacheDir, dl.name, dl.version);
    if (existsSync(targetDir)) {
      log(`  ${dl.name}/${dl.version} already cached`);
      continue;
    }
    const tmpNupkg = path.join(cacheDir, `${dl.name}.nupkg`);
    log(`  Downloading ${dl.name} ${dl.version}...`);
    try {
      await exec("curl", ["-fsSL", "-o", tmpNupkg, dl.url], { timeout: 60000 });
    } catch (e: any) {
      throw new Error(`Failed to download ${dl.name}: ${e.message?.slice(0, 100)}`);
    }
    mkdirSync(targetDir, { recursive: true });
    try {
      await exec("unzip", ["-q", "-o", tmpNupkg, "-d", targetDir], { timeout: 30000 });
    } catch (e: any) {
      throw new Error(`Failed to extract ${dl.name}: ${e.message?.slice(0, 100)}`);
    }
    // Fix permissions: .nupkg archives can contain files with mode 0000
    // (notably xDnsServer's README.md). Ansible win_copy then fails with
    // "Permission denied" reading them. Make everything readable/writable.
    try {
      await exec("chmod", ["-R", "u+rwX,go+rX", targetDir], { timeout: 10000 });
    } catch (e: any) {
      log(`  WARNING: chmod failed for ${dl.name}: ${e.message?.slice(0, 80)}`);
    }
    // Remove .nupkg packaging artifacts that aren't part of the module
    for (const junk of ["_rels", "package", "[Content_Types].xml"]) {
      const p = path.join(targetDir, junk);
      try { await rm(p, { recursive: true, force: true }); } catch {}
    }
    try { await rm(tmpNupkg, { force: true }); } catch {}
    log(`  ${dl.name} ${dl.version} cached`);
  }
}

/**
 * Pushes the cached GOAD PowerShell modules to both DC01 and WS01 via Ansible
 * win_copy. Modules land in C:\Program Files\WindowsPowerShell\Modules\<Name>\<Version>\
 * which is the system PSModulePath, so DSC and Get-Module pick them up automatically.
 *
 * Uses the inventory created by Vagrant (vagrant/vagrant credentials) since this
 * runs before the GOAD playbooks have promoted DC01.
 */
async function pushModulesToGOADVMs(
  cacheDir: string, ansibleBin: string, log: (m: string) => void,
): Promise<boolean> {
  log("  Pushing pre-built modules to GOAD VMs (host has working TLS, VMs do not)...");

  // Vagrant's default Windows credentials
  const hdr = "[" + "all" + ":" + "vars" + "]";
  const inv = [
    hdr,
    "ansible_user=vagrant",
    "ansible_password=vagrant",
    "ansible_connection=winrm",
    "ansible_winrm_transport=ntlm",
    "ansible_port=5985",
    "ansible_winrm_scheme=http",
    "ansible_winrm_server_cert_validation=ignore",
    "ansible_winrm_operation_timeout_sec=400",
    "ansible_winrm_read_timeout_sec=500",
    "",
    "[goad_targets]",
    "dc01 ansible_host=10.0.1.30",
    "ws01 ansible_host=10.0.1.31",
  ].join("\n");

  const invPath = `/tmp/goad_module_push_${Date.now()}.ini`;
  await writeFile(invPath, inv);

  // Create a tiny playbook that pushes both modules
  const playbookContent = `---
- hosts: goad_targets
  gather_facts: no
  tasks:
    - name: Ensure PSModulePath base dir exists
      win_file:
        path: 'C:\\Program Files\\WindowsPowerShell\\Modules'
        state: directory

    - name: Push ComputerManagementDsc module
      win_copy:
        src: ${cacheDir}/ComputerManagementDsc/
        dest: 'C:\\Program Files\\WindowsPowerShell\\Modules\\ComputerManagementDsc\\'

    - name: Push xNetworking module
      win_copy:
        src: ${cacheDir}/xNetworking/
        dest: 'C:\\Program Files\\WindowsPowerShell\\Modules\\xNetworking\\'

    - name: Push xDnsServer module
      win_copy:
        src: ${cacheDir}/xDnsServer/
        dest: 'C:\\Program Files\\WindowsPowerShell\\Modules\\xDnsServer\\'

    - name: Push ActiveDirectoryDsc module
      win_copy:
        src: ${cacheDir}/ActiveDirectoryDsc/
        dest: 'C:\\Program Files\\WindowsPowerShell\\Modules\\ActiveDirectoryDsc\\'

    - name: Verify modules are loadable from PSModulePath
      win_shell: |
        $cm = Get-Module -ListAvailable ComputerManagementDsc | Select-Object -First 1
        $xn = Get-Module -ListAvailable xNetworking | Select-Object -First 1
        $xd = Get-Module -ListAvailable xDnsServer | Select-Object -First 1
        $ad = Get-Module -ListAvailable ActiveDirectoryDsc | Select-Object -First 1
        if (-not $cm) { throw 'ComputerManagementDsc verification failed' }
        if (-not $xn) { throw 'xNetworking verification failed' }
        if (-not $xd) { throw 'xDnsServer verification failed' }
        if (-not $ad) { throw 'ActiveDirectoryDsc verification failed' }
        "OK: ComputerManagementDsc=$($cm.Version) xNetworking=$($xn.Version) xDnsServer=$($xd.Version) ActiveDirectoryDsc=$($ad.Version)"
`;
  const playbookPath = `/tmp/goad_module_push_${Date.now()}.yml`;
  await writeFile(playbookPath, playbookContent);

  try {
    const ok = await spawnAndWait(
      ansibleBin,
      ["-i", invPath, playbookPath],
      cacheDir, "module-push",
      { ...process.env, ANSIBLE_HOST_KEY_CHECKING: "False" },
      log, 10 * 60 * 1000,
    );
    await rm(invPath, { force: true });
    await rm(playbookPath, { force: true });
    if (ok) {
      log("  Modules pushed and verified on both VMs");
    } else {
      log("  Module push failed — see logs above");
    }
    return ok;
  } catch (err: any) {
    await rm(invPath, { force: true });
    await rm(playbookPath, { force: true });
    log(`  Module push exception: ${err.message?.slice(0, 200)}`);
    return false;
  }
}
