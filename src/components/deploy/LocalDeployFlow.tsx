"use client";

/**
 * Local Lab deploy flow (self-hosted/dev) for the Deploy hub.
 *   prereq/resource check → feasible templates → phased VBox/Vagrant deploy.
 * Reuses the existing /api/detection-lab/{system-info,deploy} endpoints +
 * ON_PREM_TEMPLATES + canRunTemplate() — does not reimplement deploy logic.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Cpu, MemoryStick, HardDrive, CheckCircle2, XCircle, Loader2, RefreshCw, Server, Shield,
  AlertTriangle, ChevronLeft, Rocket, Play, Swords, ShieldCheck, ChevronRight,
  Power, PowerOff, ExternalLink, Settings, Boxes,
} from "lucide-react";
import { ON_PREM_TEMPLATES, canRunTemplate, type LabTemplate } from "@/config/lab-templates";
import { cn } from "@/lib/utils";

interface InstalledEnv {
  id: string; name: string; templateName?: string; type: string; status: string;
  path: string; vms: string[]; vmNames?: string[]; accessUrl?: string; templateId?: string;
  cpus?: number; memoryMB?: number; diskGB?: number;
}
interface SystemInfo {
  ramGB: number; cpuCores: number; diskGB: number;
  prerequisites: Record<string, string | null>;
  installedEnvironments?: InstalledEnv[];
}

const STATUS_STYLE: Record<string, string> = {
  running: "border-success/30 bg-success/10 text-success",
  stopped: "border-border bg-muted/10 text-muted-foreground",
  partial: "border-warning/30 bg-warning/10 text-warning",
  installed: "border-info/30 bg-info/10 text-info",
  missing: "border-danger/30 bg-danger/10 text-danger",
};

function ResourceBar({ label, used, total, unit, Icon }: { label: string; used: number; total: number; unit: string; Icon: any }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="h-3 w-3" /> {label}</div>
      <div className="text-sm font-semibold text-foreground mt-0.5">{total} {unit}</div>
      <div className="h-1.5 rounded-full bg-muted/20 overflow-hidden mt-1.5"><div className={cn("h-full rounded-full", pct > 85 ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

const PREREQS = [
  { key: "virtualbox", label: "VirtualBox", critical: true },
  { key: "vagrant", label: "Vagrant", critical: true },
  { key: "ansible", label: "Ansible", critical: false },
  { key: "docker", label: "Docker", critical: false },
];

export default function LocalDeployFlow() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<LabTemplate | null>(null);

  const loadSystem = useCallback(() => {
    setLoading(true);
    fetch("/api/detection-lab/system-info").then((r) => r.json()).then((d) => setSystem(d)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadSystem(); }, [loadSystem]);

  const vboxOk = !!system?.prerequisites?.virtualbox;
  const vagrantOk = !!system?.prerequisites?.vagrant;
  const depsOk = vboxOk && vagrantOk;

  if (picked) {
    const fe = system ? canRunTemplate(picked, system) : { feasible: true, warnings: [] };
    const blockReason = !depsOk ? "VirtualBox + Vagrant are required on the host." : null;
    const feasibilityWarning = depsOk && !fe.feasible ? (fe.warnings[0] || "Host resources are below this template's requirements.") : null;
    return <PhasedPanel template={picked} canDeploy={depsOk} blockReason={blockReason} feasibility={feasibilityWarning} onBack={() => setPicked(null)} />;
  }

  return (
    <div className="space-y-5">
      {/* Prereq + resources */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Host prerequisites &amp; resources</h3>
            <p className="text-xs text-muted-foreground mt-1">Local labs run as VirtualBox VMs on this host. We check resources and required tooling before letting you install.</p>
          </div>
          <button onClick={loadSystem} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover disabled:opacity-50">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </button>
        </div>
        {loading ? <div className="py-4 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Inspecting host…</div> : system && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <ResourceBar label="RAM" used={0} total={system.ramGB} unit="GB" Icon={MemoryStick} />
              <ResourceBar label="CPU" used={0} total={system.cpuCores} unit="cores" Icon={Cpu} />
              <ResourceBar label="Disk (free)" used={0} total={system.diskGB} unit="GB" Icon={HardDrive} />
            </div>
            <div className="flex flex-wrap gap-2">
              {PREREQS.map((p) => {
                const v = system.prerequisites?.[p.key];
                const ok = !!v;
                return (
                  <span key={p.key} className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
                    ok ? "border-success/30 bg-success/10 text-success" : p.critical ? "border-danger/30 bg-danger/10 text-danger" : "border-border text-muted-foreground")}>
                    {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {p.label}{ok ? ` ${v}` : p.critical ? " — required" : " — optional"}
                  </span>
                );
              })}
            </div>
            {!depsOk && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger inline-flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> VirtualBox and Vagrant must be installed on this host to deploy a local lab.
              </div>
            )}
          </>
        )}
      </div>

      {/* Installed labs on this host */}
      <InstalledLabsPanel envs={system?.installedEnvironments || []} onChanged={loadSystem} />

      {/* Template grid */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <div><h3 className="text-sm font-semibold text-foreground">Choose a lab template</h3>
          <p className="text-xs text-muted-foreground mt-1">Already-installed templates are tagged below; templates your host can run are highlighted, ones needing more resources are dimmed.</p></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ON_PREM_TEMPLATES.map((t) => {
            const fe = system ? canRunTemplate(t, system) : { feasible: true, warnings: [] };
            const ok = fe.feasible;
            const inst = (system?.installedEnvironments || []).find((e) => e.templateId === t.id);
            return (
              <div key={t.id}
                className={cn("rounded-xl border p-4 transition-all", inst ? "border-success/40 bg-success/[0.03]" : ok ? "border-border hover:border-accent/40" : "border-border opacity-70 hover:opacity-100")}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {t.labType === "sar-goad" ? <Shield className="h-4 w-4 text-accent" /> : <Server className="h-4 w-4 text-accent" />}
                    <span className="text-sm font-semibold text-foreground">{t.name}</span>
                  </div>
                  {inst
                    ? <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLE[inst.status] || STATUS_STYLE.installed)}><CheckCircle2 className="h-3 w-3" /> Installed · {inst.status}</span>
                    : <span className="text-[10px] uppercase font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground">Not installed</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Server className="h-3 w-3" /> {t.vms.length} VM</span>
                  <span className="inline-flex items-center gap-1"><MemoryStick className="h-3 w-3" /> {t.requirements.ramGB}GB</span>
                  <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" /> {t.requirements.cpuCores}</span>
                  <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" /> {t.requirements.diskGB}GB</span>
                  {t.recommended && <span className="text-accent font-medium">★ recommended</span>}
                  <span className="ml-auto inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border uppercase">{t.size}</span>
                </div>
                {!ok && !inst && fe.warnings.length > 0 && (
                  <div className="mt-2 text-[10px] text-warning inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {fe.warnings[0]}</div>
                )}
                <div className="flex items-center gap-2 mt-3">
                  {inst ? (
                    <Link href="/detection-lab" className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-3 py-1.5 hover:bg-[#60a5fa]"><Boxes className="h-3 w-3" /> Access Lab <ChevronRight className="h-3 w-3" /></Link>
                  ) : (
                    <button onClick={() => setPicked(t)} disabled={!depsOk}
                      className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-3 py-1.5 hover:bg-[#60a5fa] disabled:opacity-40 disabled:cursor-not-allowed">
                      <Rocket className="h-3 w-3" /> Deploy
                    </button>
                  )}
                  {inst && <button onClick={() => setPicked(t)} disabled={!depsOk} className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40">Re-deploy</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Installed labs on this host (start/stop/access/manage) ──
function InstalledLabsPanel({ envs, onChanged }: { envs: InstalledEnv[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!envs.length) return null;

  const control = async (env: InstalledEnv, action: "start" | "stop") => {
    const names = env.vmNames || [];
    if (!names.length) return;
    setBusy(`${env.id}:${action}`);
    try {
      for (const vmName of names) {
        await fetch("/api/detection-lab/vm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vmName, action }),
        }).catch(() => {});
      }
    } finally { setBusy(null); onChanged(); }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Boxes className="h-4 w-4 text-accent" /> Installed on this host</h3>
          <p className="text-xs text-muted-foreground mt-1">Start, stop, access, or manage labs already deployed locally. Manage in depth from <Link href="/detection-lab" className="text-accent hover:underline">Detection Lab (advanced)</Link>.</p>
        </div>
      </div>
      <div className="space-y-2">
        {envs.map((env) => {
          const running = env.status === "running";
          const canControl = (env.vmNames || []).length > 0;
          const b = (a: string) => busy === `${env.id}:${a}`;
          return (
            <div key={env.id} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                {env.type === "sar-goad" ? <Shield className="h-4 w-4 text-accent" /> : <Server className="h-4 w-4 text-accent" />}
                <span className="text-xs font-medium text-foreground">{env.name}</span>
                <span className={cn("inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLE[env.status] || STATUS_STYLE.installed)}>{env.status}</span>
                <span className="text-[10px] text-muted-foreground">{(env.vmNames || []).length} VM</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => control(env, "start")} disabled={!canControl || running || !!busy}
                    title={canControl ? "Start all VMs" : "No managed VMs"}
                    className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2.5 py-1 text-success hover:bg-success/10 disabled:opacity-40">
                    {b("start") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />} Start
                  </button>
                  <button onClick={() => control(env, "stop")} disabled={!canControl || (!running && env.status !== "partial") || !!busy}
                    title={canControl ? "Stop all VMs" : "No managed VMs"}
                    className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2.5 py-1 text-warning hover:bg-warning/10 disabled:opacity-40">
                    {b("stop") ? <Loader2 className="h-3 w-3 animate-spin" /> : <PowerOff className="h-3 w-3" />} Stop
                  </button>
                  {env.accessUrl && (
                    <a href={env.accessUrl} target="_blank" rel="noreferrer"
                      className={cn("inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-card-hover", !running && "opacity-50")}>
                      <ExternalLink className="h-3 w-3" /> Access
                    </a>
                  )}
                  <Link href="/detection-lab" className="inline-flex items-center gap-1 text-[11px] rounded-md bg-accent text-white px-2.5 py-1 hover:bg-[#60a5fa]">
                    <Settings className="h-3 w-3" /> Access Lab
                  </Link>
                </div>
              </div>
              {/* Template used + resource consumption */}
              <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                {env.templateName && (
                  <span className="inline-flex items-center gap-1"><Boxes className="h-3 w-3" /> Template: <span className="text-foreground">{env.templateName}</span></span>
                )}
                {!!env.cpus && <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" /> {env.cpus} vCPU</span>}
                {!!env.memoryMB && <span className="inline-flex items-center gap-1"><MemoryStick className="h-3 w-3" /> {(env.memoryMB / 1024).toFixed(env.memoryMB % 1024 ? 1 : 0)} GB RAM</span>}
                {!!env.diskGB && <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" /> {env.diskGB} GB disk</span>}
              </div>
              {env.vms?.length ? <div className="mt-1 text-[10px] text-muted-foreground font-mono truncate">{env.vms.join(" · ")}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PhaseState { status: string; durationMs: number; logs: string[]; error: string | null }
interface DeploymentState { currentPhase: string | null; phases: Record<string, PhaseState> }

// Full, scrollable, auto-following log viewer for a deployment phase.
function LogView({ lines, live }: { lines: string[]; live: boolean }) {
  const ref = useRef<HTMLPreElement | null>(null);
  const stickToBottom = useRef(true);
  const [wrap, setWrap] = useState(false);

  // Auto-scroll to the newest line while running, unless the user scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2 mb-1 text-[10px] text-muted-foreground">
        <span>{lines.length} log line{lines.length === 1 ? "" : "s"}</span>
        {live && <span className="inline-flex items-center gap-1 text-info"><Loader2 className="h-2.5 w-2.5 animate-spin" /> live</span>}
        <button onClick={() => setWrap((w) => !w)} className="ml-auto hover:text-foreground underline decoration-dotted">{wrap ? "no wrap" : "wrap"}</button>
        <button
          onClick={() => { navigator.clipboard?.writeText(lines.join("\n")).catch(() => {}); }}
          className="hover:text-foreground underline decoration-dotted">copy</button>
      </div>
      <pre
        ref={ref}
        onScroll={onScroll}
        className={cn(
          "text-[10px] font-mono text-muted-foreground bg-background/60 border border-border rounded-md p-2 max-h-96 overflow-auto",
          wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
        )}
      >{lines.join("\n")}</pre>
    </div>
  );
}

function PhasedPanel({ template, canDeploy, blockReason, onBack, feasibility }: {
  template: LabTemplate; canDeploy: boolean; blockReason: string | null; onBack: () => void;
  feasibility: string | null;
}) {
  // Deploy under the project (big disk), not the root-disk home — the root disk
  // is chronically near-full and VM growth there pauses/crashes the guests. The
  // deploy route resolves this relative to the project root (server cwd).
  const [deployPath] = useState(() => `.detectops-labs/${template.id}`);
  const [state, setState] = useState<DeploymentState | null>(null);
  const [running, setRunning] = useState(false);
  const [registered, setRegistered] = useState<{ notes: string[] } | null>(null);
  const [registering, setRegistering] = useState(false);

  const phases = (template.labType === "sar-goad"
    ? ["prepare", "sar", "goad"]
    : template.labType === "sar-docker"
      ? ["prepare", "sar"]
      : ["prepare", "sar"]) as Array<"prepare" | "sar" | "goad" | "tools">;
  const phaseMeta: Record<string, { title: string; sub: string }> = {
    prepare: { title: "Prepare", sub: "Copy + patch sources" },
    sar: { title: "SAR / Splunk", sub: "Build Splunk + DC, verify Splunk Web + receiver" },
    goad: { title: "GOAD + forwarding", sub: "AD lab + Splunk Forwarder + Sysmon" },
    tools: { title: "Tools", sub: "Adversary tooling" },
  };

  const poll = useCallback(async () => {
    try { const r = await fetch(`/api/detection-lab/deploy?deployPath=${encodeURIComponent(deployPath)}`); if (r.ok) { const j = await r.json(); if (j.deployment) setState(j.deployment); } } catch {}
  }, [deployPath]);
  useEffect(() => { poll(); }, [poll]);
  useEffect(() => {
    if (!state?.currentPhase) return;
    const iv = setInterval(async () => {
      try { const r = await fetch("/api/detection-lab/deploy"); if (r.ok) { const j = await r.json(); if (j.deployment) setState(j.deployment); if (!j.hasActive) setRunning(false); } } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, [state?.currentPhase]);

  // When every phase has succeeded, auto-register the lab into the sim pipeline.
  const allDone = !!state && phases.every((p) => {
    const s = state.phases?.[p]?.status; return s === "success" || s === "skipped";
  });
  useEffect(() => {
    if (!allDone || registered || registering) return;
    setRegistering(true);
    fetch("/api/deploy/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "local", templateId: template.id }) })
      .then((r) => r.json()).then((d) => { if (d.ok) setRegistered({ notes: d.notes || [] }); })
      .finally(() => setRegistering(false));
  }, [allDone, registered, registering, template.id]);

  const runPhase = async (phase: string) => {
    if (!canDeploy) return;
    setRunning(true);
    try {
      const r = await fetch("/api/detection-lab/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: template.id, deployPath, phase }) });
      const j = await r.json();
      if (j.deployment) setState(j.deployment);
    } finally { setRunning(false); }
  };

  const ICON: Record<string, { Icon: any; color: string }> = {
    success: { Icon: CheckCircle2, color: "text-success" }, failed: { Icon: XCircle, color: "text-danger" },
    running: { Icon: Loader2, color: "text-info" }, pending: { Icon: Play, color: "text-muted-foreground" }, skipped: { Icon: CheckCircle2, color: "text-muted-foreground" },
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Templates</button>
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2"><Rocket className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
          <span className="text-[10px] uppercase font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground">{template.size}</span></div>
        <p className="text-[11px] text-muted-foreground">Install path: <code className="font-mono">{deployPath}</code> · {template.vms.length} VM · {template.requirements.ramGB}GB RAM</p>
        {blockReason && <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger inline-flex items-start gap-2"><AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {blockReason}</div>}
        {!blockReason && feasibility && <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning inline-flex items-start gap-2"><AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {feasibility} — you can still try, but it may be slow.</div>}

        <div className="space-y-2 pt-1">
          {phases.map((p, i) => {
            const ps = state?.phases?.[p];
            const st = ps?.status || "pending";
            const ic = ICON[st] || ICON.pending;
            const prevDone = i === 0 || state?.phases?.[phases[i - 1]]?.status === "success" || state?.phases?.[phases[i - 1]]?.status === "skipped";
            return (
              <div key={p} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center gap-2">
                  <ic.Icon className={cn("h-4 w-4", ic.color, st === "running" && "animate-spin")} />
                  <span className="text-xs font-medium text-foreground">Phase {i}: {phaseMeta[p].title}</span>
                  <span className="text-[10px] text-muted-foreground">{phaseMeta[p].sub}</span>
                  <span className={cn("ml-auto text-[10px] uppercase font-bold", ic.color)}>{st}</span>
                  <button onClick={() => runPhase(p)} disabled={!canDeploy || running || !prevDone || st === "running" || st === "success"}
                    className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-40">
                    {running && state?.currentPhase === p ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
                  </button>
                </div>
                {ps?.error && <div className="mt-1 text-[10px] text-danger whitespace-pre-wrap">{ps.error}</div>}
                {ps?.logs?.length ? <LogView lines={ps.logs} live={st === "running"} /> : null}
              </div>
            );
          })}
        </div>

        {/* Auto-registration → ready to simulate */}
        {registering && (
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Registering this lab into the simulation pipeline…
          </div>
        )}
        {registered && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Lab deployed &amp; registered — ready to simulate</div>
            {registered.notes.map((n, i) => <div key={i} className="text-[11px] text-muted-foreground pl-6">• {n}</div>)}
            <div className="flex items-center gap-2 pl-6 pt-1 flex-wrap">
              <Link href="/detections/enterprise/environments/fleet" className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-3 py-1.5 hover:bg-[#60a5fa]"><Swords className="h-3 w-3" /> Simulate <ChevronRight className="h-3 w-3" /></Link>
              <Link href="/detections/enterprise/environments" className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"><Server className="h-3 w-3" /> View environment</Link>
              <Link href="/integrations" className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"><ShieldCheck className="h-3 w-3" /> Test Splunk</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
