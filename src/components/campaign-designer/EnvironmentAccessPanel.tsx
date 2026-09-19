"use client";

/**
 * Active Environments — categorized, collapsible access panel for the Campaign
 * Designer. Groups everything the user has stood up into three sections:
 *
 *   Local Lab        — SAR/GOAD VMs on the host (Splunk, Windows DC, Caldera creds)
 *   Cloud Lab        — SAR ranges in the user's cloud (per-server RDP/SSH creds)
 *   Fleet Simulation — signed agents on the user's endpoints (host + privilege)
 *
 * Each section expands/collapses; credential rows reveal/copy on demand so an
 * analyst can grab the IP:port + login to reach the service.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronDown, ChevronRight, RefreshCw, Loader2, Server, Cloud, Cpu,
  Eye, EyeOff, Copy, Check, ExternalLink, ShieldAlert, ShieldCheck, KeyRound, Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

function ManageLink({ view }: { view: "local" | "cloud" | "fleet" }) {
  return (
    <Link
      href={`/deploy?view=${view}`}
      className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors"
      title="Open this lab in the Deploy console to start/stop, re-deploy, or configure it"
    >
      <Settings className="h-3 w-3" /> Manage
    </Link>
  );
}

// ── Minimal structural prop types (compatible with the page's interfaces) ──
interface SARConfig {
  splunk: { ip: string; adminPassword: string; version: string };
  windows: { dcIp: string; username: string; password: string };
  caldera: { password: string; ip: string };
}
interface SAR { connected: boolean; installPath: string; config: SARConfig }
interface InstalledEnv { id: string; name: string; templateName?: string; templateId?: string; type: string; status: string; path: string; vms: string[]; fleetLab?: boolean }
interface Target {
  deployedName: string; displayName: string; state: string; role: string; os: string; ip: string;
  source: "sar" | "deployed-lab" | "cloud" | "fleet" | "c2";
  labName?: string; labPath?: string; rangeId?: string;
  credentials?: { username: string; password: string };
  fleetId?: string; nodeId?: string; hostStatus?: Record<string, unknown>; liveness?: string; c2Id?: string;
}
interface CloudRange {
  attack_range_id?: string | null; attack_range_name?: string | null; template_name?: string | null; status: string;
  result?: {
    architecture?: Array<{ name: string; os_type?: string | null }> | null;
    guacamole_info?: { host_ip?: string; servers?: Array<{ name: string; hostname: string; port: number; protocol: string; username: string; password: string }> | null } | null;
    router_public_ip?: string | null;
  } | null;
  router_public_ip?: string | null;
}

interface LabCreds {
  available: boolean;
  installPath?: string;
  splunk: { ip: string; webUrl: string; apiUrl: string; hecUrl: string; user: string; password: string };
  ssh: { user: string; host: string; hint: string };
  windows: { ip: string; access: string; user: string; password: string };
  caldera: { ip: string; url: string; user: string; password: string } | null;
}

interface Props {
  loading: boolean;
  error: string | null;
  sar: SAR | null;
  installedEnvs: InstalledEnv[];
  labTargets: Target[];
  cloudRanges: CloudRange[];
  fleetTargets: Target[];
  onRefresh: () => void;
}

const MASK = "••••••••";
const clean = (v?: string) => (v && v !== MASK ? v : "");

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {}); }}
      className="text-muted-foreground hover:text-foreground shrink-0" title="Copy">
      {done ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/** One credential/service row: label, address (URL/IP), optional user + password. */
function CredRow({ label, addr, href, user, password, reveal }: {
  label: string; addr: string; href?: string; user?: string; password?: string; reveal: boolean;
}) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 items-start py-1 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <div className="space-y-0.5 min-w-0">
        <div className="flex items-center gap-1.5">
          {href
            ? <a href={href} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline break-all inline-flex items-center gap-1">{addr}<ExternalLink className="h-2.5 w-2.5" /></a>
            : <span className="font-mono text-foreground break-all">{addr}</span>}
          <CopyBtn text={addr} />
        </div>
        {(user || password) && (
          <div className="flex items-center gap-2 flex-wrap text-muted-foreground">
            {user && <span>user <span className="font-mono text-foreground">{user}</span></span>}
            {password && (
              <span className="inline-flex items-center gap-1">
                pass <span className="font-mono text-foreground">{reveal ? password : MASK}</span>
                <CopyBtn text={password} />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PrivChip({ host }: { host?: Record<string, unknown> }) {
  const integrity = String((host?.integrity as string) || ((host?.elevated as boolean) ? "high" : "")).toLowerCase();
  if (!integrity) return <span className="text-[9px] rounded px-1 py-0.5 border border-border text-muted-foreground">priv: unknown</span>;
  const elevated = host?.elevated === true || ["system", "high", "root"].includes(integrity);
  const label = integrity === "system" ? "SYSTEM" : integrity === "root" ? "ROOT" : integrity === "high" ? "HIGH (admin)" : integrity === "medium" ? "MEDIUM" : "LOW (user)";
  return (
    <span className={cn("text-[9px] font-bold rounded px-1 py-0.5 border inline-flex items-center gap-0.5",
      elevated ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success")}>
      {elevated ? <ShieldAlert className="h-2.5 w-2.5" /> : <ShieldCheck className="h-2.5 w-2.5" />}{label}
    </span>
  );
}

function Section({ id, title, Icon, count, open, onToggle, children }: {
  id: string; title: string; Icon: any; count: number; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-card-hover transition-colors text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Icon className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className={cn("text-[10px] font-bold rounded-full px-2 py-0.5", count > 0 ? "bg-accent/15 text-accent" : "bg-muted/15 text-muted-foreground")}>
          {count}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">{open ? "collapse" : "expand"}</span>
      </button>
      {open && <div className="border-t border-border p-4 space-y-3">{children}</div>}
    </div>
  );
}

export default function EnvironmentAccessPanel({ loading, error, sar, installedEnvs, labTargets, cloudRanges, fleetTargets, onRefresh }: Props) {
  // A Fleet detection lab (deployed from Fleet Simulation → "Virtual Labs / VMs")
  // belongs under "Fleet Simulation", not "Local Lab". It's flagged fleetLab, OR
  // it's a SAR lab under the project's labs/deployments/ dir (where that panel
  // deploys) — the same heuristic the deploy hub uses, so a fleet lab never shows
  // up as a duplicate under Local Lab.
  const isFleetLab = (e: InstalledEnv) =>
    !!e.fleetLab || ((e.type === "sar" || e.type === "sar-docker") && /[\\/]labs[\\/]deployments[\\/]/.test(e.path || ""));
  // De-duplicate by deploy path so the same lab can't appear twice in a section.
  const seenPath = new Set<string>();
  const uniqueEnvs = installedEnvs.filter((e) => { const k = e.path || e.id; if (seenPath.has(k)) return false; seenPath.add(k); return true; });
  const localEnvs = uniqueEnvs.filter((e) => !!e.templateId && !isFleetLab(e));
  const fleetLabEnvs = uniqueEnvs.filter((e) => isFleetLab(e));
  const runningCloud = cloudRanges.filter((r) => r.status === "running");
  const fleetByFleet = new Map<string, Target[]>();
  for (const t of fleetTargets) {
    const k = t.fleetId || t.labName || "fleet";
    (fleetByFleet.get(k) || fleetByFleet.set(k, []).get(k)!).push(t);
  }
  const fleetCount = Array.from(fleetByFleet.values()).reduce((n, a) => n + a.length, 0) + fleetLabEnvs.length;

  const [open, setOpen] = useState<Record<string, boolean>>({
    local: localEnvs.length > 0,
    cloud: runningCloud.length > 0,
    fleet: fleetByFleet.size > 0 || fleetLabEnvs.length > 0,
  });
  const [reveal, setReveal] = useState(false);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // The lab whose services/credentials to show = the one actually powered on.
  // Only one SAR lab runs at a time (they share the 10.0.1.0/24 network), so the
  // "Services & credentials" block follows whichever lab — local or fleet — is up.
  const poweredOn = (s: string) => ["running", "partial", "unreachable"].includes(s);
  const activeLocal = localEnvs.find((e) => poweredOn(e.status)) || null;
  const activeFleetLab = fleetLabEnvs.find((e) => poweredOn(e.status)) || null;
  const activeLabPath = (activeFleetLab || activeLocal)?.path || "";

  // Real lab credentials (Splunk/Windows/Caldera/SSH) — session-gated endpoint
  // that returns plaintext, unlike /api/sar/status which masks everything. Fetched
  // for the SPECIFIC running lab's deployPath so creds match the lab that's up.
  const [creds, setCreds] = useState<LabCreds | null>(null);
  useEffect(() => {
    if (!activeLabPath) { setCreds(null); return; }
    fetch(`/api/sar/credentials?deployPath=${encodeURIComponent(activeLabPath)}`)
      .then((r) => r.json())
      .then((d) => setCreds(d && d.available ? d : null))
      .catch(() => setCreds(null));
  }, [activeLabPath]);

  const vmState = (name: string) => labTargets.find((t) => t.deployedName === name)?.state;

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <span className="text-sm text-muted-foreground">Probing environments…</span>
      </div>
    );
  }

  // Shared SAR creds/IPs (10.0.1.0/24 defaults) used across local labs.
  const sc = sar?.config;
  const splunkIp = clean(sc?.splunk.ip);
  const winIp = clean(sc?.windows.dcIp);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted uppercase">Active Environments</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setReveal((v) => !v)} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover">
            {reveal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {reveal ? "Hide" : "Show"} credentials
          </button>
          <button onClick={onRefresh} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      {error && !sar && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">{error}</div>
      )}

      {/* ── Local Lab ── */}
      <Section id="local" title="Local Lab" Icon={Server} count={localEnvs.length} open={!!open.local} onToggle={() => toggle("local")}>
        {localEnvs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No local labs deployed. Deploy one from the Deploy hub.</p>
        ) : (
          <>
            {localEnvs.map((env) => {
              const vms = labTargets.filter((t) => t.source === "deployed-lab" && t.labPath === env.path);
              return (
                <div key={env.id} className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Server className="h-3.5 w-3.5 text-accent" />
                    <span className="text-xs font-semibold text-foreground">{env.templateName || env.name}</span>
                    <span className={cn("text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full border",
                      env.status === "running" ? "border-success/30 bg-success/10 text-success" :
                      env.status === "partial" ? "border-warning/30 bg-warning/10 text-warning" :
                  env.status === "unreachable" ? "border-danger/30 bg-danger/10 text-danger" :
                      "border-border text-muted-foreground")}>{env.status}</span>
                    <span className="text-[10px] text-muted-foreground">{vms.length} VM</span>
                    <ManageLink view="local" />
                  </div>
                  {vms.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {vms.map((v) => (
                        <span key={v.deployedName} className={cn("text-[10px] font-mono rounded px-1.5 py-0.5 border",
                          (vmState(v.deployedName) || v.state) === "running" ? "border-success/30 text-success" : "border-border text-muted-foreground")}>
                          {v.displayName}{v.ip ? ` · ${v.ip}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Services & credentials — shown only for the LOCAL lab that's running */}
            {activeLocal ? (
            <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-3">
              <p className="text-[10px] font-semibold text-accent uppercase flex items-center gap-1.5 mb-1"><KeyRound className="h-3 w-3" /> Services &amp; credentials <span className="normal-case font-normal text-muted-foreground">· {activeLocal.templateName || activeLocal.name}</span></p>
              {creds ? (
                <div className="divide-y divide-border/60">
                  <CredRow reveal={reveal} label="Splunk Web" addr={creds.splunk.webUrl} href={creds.splunk.webUrl} user={creds.splunk.user} password={creds.splunk.password} />
                  <CredRow reveal={reveal} label="Splunk API / mgmt" addr={creds.splunk.apiUrl} />
                  <CredRow reveal={reveal} label="Splunk HEC" addr={creds.splunk.hecUrl} />
                  <CredRow reveal={reveal} label="Splunk host (SSH)" addr={creds.ssh.hint} user={creds.ssh.user} />
                  <CredRow reveal={reveal} label="Windows DC (RDP/WinRM)" addr={creds.windows.ip} user={creds.windows.user} password={creds.windows.password} />
                  {creds.caldera
                    ? <CredRow reveal={reveal} label="Caldera C2" addr={creds.caldera.url} href={creds.caldera.url} user={creds.caldera.user} password={creds.caldera.password} />
                    : <p className="text-[10px] text-muted-foreground pt-1.5">Caldera: not set in this lab&apos;s <span className="font-mono">attack_range_local.conf</span> (<span className="font-mono">caldera.caldera_password</span>). If you added Caldera as an Enterprise Environment instead, its URL/API key live under Simulation → Enterprise Environments.</p>}
                </div>
              ) : sc && (splunkIp || winIp) ? (
                <div className="divide-y divide-border/60">
                  {splunkIp && <CredRow reveal={reveal} label="Splunk Web" addr={`http://${splunkIp}:8000`} href={`http://${splunkIp}:8000`} user="admin" />}
                  {winIp && <CredRow reveal={reveal} label="Windows DC (RDP/WinRM)" addr={winIp} user={clean(sc.windows.username) || "Administrator"} />}
                  <p className="text-[10px] text-muted-foreground pt-1.5">Passwords load from the running lab config — click Refresh once the lab is up.</p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Start the lab to read live credentials.</p>
              )}
            </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">Start a local lab to see its services &amp; credentials.</p>
            )}
          </>
        )}
      </Section>

      {/* ── Cloud Lab ── */}
      <Section id="cloud" title="Cloud Lab" Icon={Cloud} count={runningCloud.length} open={!!open.cloud} onToggle={() => toggle("cloud")}>
        {runningCloud.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No running cloud ranges. Build one from the Deploy hub → Cloud Lab.</p>
        ) : runningCloud.map((r) => {
          const guac = r.result?.guacamole_info?.servers || [];
          const router = r.router_public_ip || r.result?.router_public_ip || "";
          return (
            <div key={r.attack_range_id || r.attack_range_name || Math.random()} className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Cloud className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-semibold text-foreground">{r.attack_range_name || "Cloud range"}</span>
                {r.template_name && <span className="text-[10px] text-muted-foreground">{r.template_name.replace(/\.yml$/, "")}</span>}
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full border border-success/30 bg-success/10 text-success">{r.status}</span>
                <ManageLink view="cloud" />
              </div>
              <div className="divide-y divide-border/60">
                {router && <CredRow reveal={reveal} label="Router (WireGuard)" addr={router} />}
                {guac.length === 0 && <p className="text-[11px] text-muted-foreground py-1">Access details appear once the range finishes provisioning.</p>}
                {guac.map((s) => (
                  <CredRow key={s.name} reveal={reveal}
                    label={`${s.name} (${(s.protocol || "").toUpperCase()})`}
                    addr={`${s.hostname}:${s.port}`} user={s.username} password={s.password} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      {/* ── Fleet Simulation ── */}
      <Section id="fleet" title="Fleet Simulation" Icon={Cpu} count={fleetCount} open={!!open.fleet} onToggle={() => toggle("fleet")}>
        {/* Fleet detection labs (Splunk + Windows) deployed from Fleet Simulation */}
        {fleetLabEnvs.map((env) => {
          // Match by unique deploy path only — matching by name would pull in VMs
          // from another lab that happens to share the same template name (e.g. two
          // "SAR Minimal" deploys), showing each VM twice under different networks.
          const vms = labTargets.filter((t) => t.source === "deployed-lab" && t.labPath === env.path);
          return (
            <div key={env.id} className="rounded-lg border border-purple/20 bg-purple/[0.03] p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Server className="h-3.5 w-3.5 text-purple" />
                <span className="text-xs font-semibold text-foreground">{env.templateName || env.name}</span>
                <span className="text-[10px] uppercase text-muted-foreground">detection lab</span>
                <span className={cn("text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full border",
                  env.status === "running" ? "border-success/30 bg-success/10 text-success" :
                  env.status === "partial" ? "border-warning/30 bg-warning/10 text-warning" :
                  env.status === "unreachable" ? "border-danger/30 bg-danger/10 text-danger" : "border-border text-muted-foreground")}>{env.status}</span>
                <ManageLink view="fleet" />
              </div>
              {vms.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {vms.map((v) => (
                    <span key={v.deployedName} className={cn("text-[10px] font-mono rounded px-1.5 py-0.5 border",
                      (vmState(v.deployedName) || v.state) === "running" ? "border-success/30 text-success" : "border-border text-muted-foreground")}>
                      {v.displayName}{v.ip ? ` · ${v.ip}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {activeFleetLab && activeFleetLab.id === env.id && creds && (
                <div className="divide-y divide-border/60 pt-1">
                  <p className="text-[10px] font-semibold text-purple uppercase flex items-center gap-1.5 pb-1"><KeyRound className="h-3 w-3" /> Services &amp; credentials</p>
                  <CredRow reveal={reveal} label="Splunk Web" addr={creds.splunk.webUrl} href={creds.splunk.webUrl} user={creds.splunk.user} password={creds.splunk.password} />
                  <CredRow reveal={reveal} label="Splunk API / mgmt" addr={creds.splunk.apiUrl} />
                  <CredRow reveal={reveal} label="Windows host" addr={creds.windows.ip} user={creds.windows.user} password={creds.windows.password} />
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">Fleet endpoints forward telemetry here (<span className="font-mono">:9997</span>); the platform queries it for real-time detection.</p>
            </div>
          );
        })}

        {fleetByFleet.size === 0 && fleetLabEnvs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No enrolled fleet endpoints online. Enroll one from Deploy → Remote Fleet.</p>
        ) : Array.from(fleetByFleet.entries()).map(([k, nodes]) => (
          <div key={k} className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Cpu className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-semibold text-foreground">{nodes[0].labName || "Remote Fleet"}</span>
              <span className="text-[10px] text-muted-foreground">{nodes.length} node{nodes.length !== 1 ? "s" : ""}</span>
              <ManageLink view="fleet" />
            </div>
            <div className="space-y-1.5">
              {nodes.map((n) => (
                <div key={n.deployedName} className="flex items-center gap-2 flex-wrap text-[11px]">
                  <span className={cn("w-1.5 h-1.5 rounded-full", n.state === "running" ? "bg-success" : "bg-muted-foreground")} />
                  <span className="font-mono text-foreground">{n.displayName}</span>
                  {n.os && <span className="text-muted-foreground">{n.os}</span>}
                  <PrivChip host={n.hostStatus} />
                  {!!(n.hostStatus?.user) && <span className="text-muted-foreground">as <span className="font-mono text-foreground">{String(n.hostStatus.user)}</span></span>}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">Access is via the signed agent — no interactive login. Privilege above shows which endpoints can run elevated techniques.</p>
          </div>
        ))}
      </Section>
    </div>
  );
}
