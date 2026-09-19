"use client";

/**
 * Fleet Simulation → "Virtual Labs / VMs".
 *
 * A grid of the VM labs the fleet forwards to for real-time detection. Each lab
 * is a card: click it to reveal install info + per-VM state; start / stop /
 * destroy it inline (like a C2 server) or jump to Manage Labs. A "Deploy a lab"
 * card stands up the proven SAR-minimal lab (Ubuntu Splunk Enterprise + a Windows
 * host running the Universal Forwarder + Sysmon).
 *
 * The build runs SERVER-SIDE and auto-chains prepare→sar (autoChain:true), so it
 * advances on its own; the UI polls the on-disk deployment state by path, which
 * survives page reloads. Shows a progress bar, live logs, and an ETA. The grid is
 * multi-lab by design so more VM labs can be added here later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Database, Loader2, Play, Square, Trash2, Server, ShieldCheck, ChevronDown, ChevronRight, AlertTriangle, Check, Coffee, RefreshCw, ExternalLink, Wrench, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const TEMPLATE_ID = "sar-fleet-detection";
const LS_KEY = "detectlab-deploy";   // { deployPath, networkBase, adminPw }

interface PhaseState { status: string; logs?: string[]; error?: string | null; result?: any; startedAt?: string | null }
interface DeployState { templateId: string; deployPath: string; currentPhase: string | null; phases: Record<string, PhaseState>; createdAt?: string }
interface LabInfo { id: string; name: string; status: string; path: string; accessUrl?: string; type?: string; vms: string[]; vmNames: string[] }
type SiemMsg = { id: string; text: string } | null;

// Milestones parsed from the joined logs → a rough but honest progress %.
const MILESTONES: Array<{ pct: number; label: string; match: RegExp }> = [
  { pct: 8, label: "Preparing files", match: /Preparing deploy directory|Copying SAR/i },
  { pct: 18, label: "Lab configured", match: /Prepare phase complete/i },
  { pct: 30, label: "Building VMs (Vagrant + Ansible)", match: /attack_range_local\.py|Building|vagrant up/i },
  { pct: 65, label: "Waiting for Splunk web", match: /Waiting for Splunk Web/i },
  { pct: 80, label: "Splunk web up", match: /Splunk Web: OK|Splunk Web.*OK after/i },
  { pct: 90, label: "Splunk receiver up", match: /Splunk receiver: OK|receiving port/i },
  { pct: 100, label: "Splunk ready", match: /SAR phase complete|Registered deployment/i },
];

const LAB_STATUS_STYLE = (s: string) =>
  s === "running" ? "border-success/30 bg-success/10 text-success"
  : s === "unreachable" || s === "missing" ? "border-danger/30 bg-danger/10 text-danger"
  : s === "partial" ? "border-warning/30 bg-warning/10 text-warning"
  : "border-border text-muted-foreground";

// VMs are powered on whenever the status isn't a fully-off one — "unreachable"/
// "partial" still mean running VMs the user must be able to Stop (Splunk just
// isn't answering yet), so we also sniff the per-VM state strings.
const isPoweredOn = (lab: LabInfo) =>
  ["running", "unreachable", "partial"].includes(lab.status) || (lab.vms || []).some((v) => /running/i.test(v));

export default function DetectionLabDeploy() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);              // deploy-form panel
  const [splunkRam, setSplunkRam] = useState(4096);
  const [splunkCpus, setSplunkCpus] = useState(2);
  const [winRam, setWinRam] = useState(2048);
  const [winCpus, setWinCpus] = useState(1);
  const [networkBase, setNetworkBase] = useState("192.168.56");
  const [adminPw, setAdminPw] = useState("I-l1ke-Attack-Range!");

  const [deployPath, setDeployPath] = useState<string | null>(null);
  const [state, setState] = useState<DeployState | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Starts at 0, not Date.now(): calling it during render gives the server and
  // client different values. It's only read once `startedAt` is set (client-side,
  // after a deploy starts), and the 1s clock below keeps it current.
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [siemMsg, setSiemMsg] = useState<SiemMsg>(null);
  // All deployed VM labs (survives reloads / other sessions) rendered as a grid
  // so each can be managed (stop/start/destroy) and more can be added later.
  const [existingLabs, setExistingLabs] = useState<LabInfo[]>([]);
  const [lcBusy, setLcBusy] = useState<string | null>(null);   // `${labId}:${action}`
  const pollRef = useRef<any>(null);
  const clockRef = useRef<any>(null);

  // Find the deployed VM labs to manage: flagged fleetLab; the exact deploy this
  // panel launched (localStorage path); or any SAR lab under the project's
  // labs/deployments/ dir — which is where this panel always deploys.
  const loadExisting = useCallback(async () => {
    let savedPath = "";
    try { savedPath = (JSON.parse(localStorage.getItem(LS_KEY) || "null") || {}).deployPath || ""; } catch { /* ignore */ }
    try {
      const r = await fetch("/api/detection-lab/system-info");
      const d = await r.json();
      const isProjectDeploy = (p: string) => /[\\/]labs[\\/]deployments[\\/]/.test(p || "");
      const envs = (d.installedEnvironments || []) as any[];
      const labs = envs.filter((e) =>
        e.fleetLab
        || (savedPath && e.path === savedPath)
        || ((e.type === "sar" || e.type === "sar-docker") && isProjectDeploy(e.path)),
      );
      setExistingLabs(labs.map((e) => ({
        id: e.id, name: e.templateName || e.name, status: e.status, path: e.path,
        accessUrl: e.accessUrl, type: e.type, vms: e.vms || [], vmNames: e.vmNames || [],
      })));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetch("/api/deploy/capabilities").then((r) => r.json()).then((d) => setAvailable(!!d.localAvailable)).catch(() => {});
    void loadExisting();
    // Resume an in-progress / finished deploy across reloads.
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      if (saved?.deployPath) {
        setDeployPath(saved.deployPath);
        if (saved.networkBase) setNetworkBase(saved.networkBase);
        if (saved.adminPw) setAdminPw(saved.adminPw);
        startPolling(saved.deployPath);
      }
    } catch { /* ignore */ }
    return () => { if (pollRef.current) clearInterval(pollRef.current); if (clockRef.current) clearInterval(clockRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase = (s: DeployState | null) => ({
    prep: s?.phases?.prepare?.status, sar: s?.phases?.sar?.status,
  });

  const startPolling = useCallback((dp: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (clockRef.current) clearInterval(clockRef.current);
    setStartedAt((prev) => prev ?? Date.now());
    clockRef.current = setInterval(() => setNow(Date.now()), 1000);
    const tick = async () => {
      try {
        const r = await fetch(`/api/detection-lab/deploy?deployPath=${encodeURIComponent(dp)}`);
        if (!r.ok) return;
        const d = await r.json();
        const s: DeployState | null = d.deployment;   // GET wraps state under .deployment
        if (!s || !s.phases) return;
        setState(s);
        const { prep, sar } = phase(s);
        if (sar === "success" || sar === "failed" || prep === "failed") {
          clearInterval(pollRef.current); pollRef.current = null;
          clearInterval(clockRef.current); clockRef.current = null;
          void loadExisting();   // surface the now-deployed lab for management
        }
      } catch { /* keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 4000);
  }, [loadExisting]);

  // Manage a deployed lab (stop/start/destroy) via the deploy lifecycle. The POST
  // returns after the action completes server-side.
  const manageLifecycle = async (action: "stop" | "resume" | "destroy", lab: LabInfo) => {
    setLcBusy(`${lab.id}:${action}`);
    try {
      await fetch("/api/detection-lab/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, deployPath: lab.path }),
      });
      if (action === "destroy") {
        let savedPath = "";
        try { savedPath = (JSON.parse(localStorage.getItem(LS_KEY) || "null") || {}).deployPath || ""; } catch { /* ignore */ }
        if (savedPath && savedPath === lab.path) { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } setState(null); setDeployPath(null); }
      }
      await loadExisting();
    } catch { /* best-effort */ } finally { setLcBusy(null); }
  };

  const deploy = async () => {
    setError(null); setSiemMsg(null); setState(null); setStartedAt(Date.now());
    try {
      const r = await fetch("/api/detection-lab/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: TEMPLATE_ID, phase: "prepare", autoChain: true,
          config: {
            splunk_admin_password: adminPw, networkBase,
            resources: { splunk_server: { memory: splunkRam, cpus: splunkCpus }, windows_domain_controller: { memory: winRam, cpus: winCpus } },
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "deploy failed to start"); setStartedAt(null); return; }
      const dp = d.deployment?.deployPath;
      if (!dp) { setError("no deployPath returned"); return; }
      setDeployPath(dp); setOpen(false);
      try { localStorage.setItem(LS_KEY, JSON.stringify({ deployPath: dp, networkBase, adminPw })); } catch { /* ignore */ }
      startPolling(dp);
    } catch (e: any) { setError(e?.message || String(e)); setStartedAt(null); }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (clockRef.current) clearInterval(clockRef.current);
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    setState(null); setDeployPath(null); setStartedAt(null); setError(null); setSiemMsg(null);
    void loadExisting();
  };

  // Register the lab's Splunk as the fleet detection SIEM. `lab` omitted = the
  // just-finished deploy (use its result IP / the configured network base).
  const useForFleetDetection = async (lab?: LabInfo) => {
    const id = lab?.id || "deploy";
    let ip = state?.phases?.sar?.result?.splunkIp || `${networkBase}.12`;
    if (lab?.accessUrl) { try { ip = new URL(lab.accessUrl).hostname; } catch { /* keep default */ } }
    setSiemMsg(null);
    try {
      const r = await fetch("/api/siem", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Fleet Splunk (lab ${ip})`, kind: "splunk", scope: "fleet", url: `https://${ip}:8089`, authMode: "basic", username: "admin", password: adminPw, isDefault: true }),
      });
      const d = await r.json();
      if (!r.ok) { setSiemMsg({ id, text: d.error || "failed to register SIEM" }); return; }
      await fetch(`/api/siem/${d.connection.id}/test`, { method: "POST" }).catch(() => {});
      setSiemMsg({ id, text: `Registered as the fleet detection SIEM → https://${ip}:8089. Use it in Campaign Designer → Simulation & Detection.` });
    } catch (e: any) { setSiemMsg({ id, text: e?.message || String(e) }); }
  };

  const { prep, sar } = phase(state);
  const running = (!!deployPath && sar !== "success" && sar !== "failed" && prep !== "failed") && (!!prep || !!startedAt);
  const done = sar === "success";
  const failed = sar === "failed" || prep === "failed";
  const logs = [...(state?.phases?.prepare?.logs || []), ...(state?.phases?.sar?.logs || [])];
  const joined = logs.join("\n");
  const progress = done ? 100 : MILESTONES.filter((m) => m.match.test(joined)).reduce((mx, m) => Math.max(mx, m.pct), running ? 4 : 0);
  const curLabel = done ? "Splunk ready" : failed ? "Failed" : (MILESTONES.filter((m) => m.match.test(joined)).slice(-1)[0]?.label || "Starting…");
  // `now` is 0 until the 1s clock ticks, so require it before subtracting —
  // otherwise the timer would flash a large negative value for up to a second.
  const elapsed = startedAt && now ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const splunkIpDeploy = state?.phases?.sar?.result?.splunkIp || `${networkBase}.12`;

  // The live deploy (progress + logs + "✓ Splunk lab is up") is rendered INSIDE
  // the matching lab card's collapsible — not as a separate panel — so logs only
  // show on click. Until the lab is registered (mid-build) it has no card yet, so
  // a transient row carries the same view.
  const deployView: DeployView | null = deployPath ? {
    progress, curLabel, mmss, running, done, failed, logs,
    splunkIp: splunkIpDeploy, adminPw, deployPath,
    errorText: state?.phases?.sar?.error || state?.phases?.prepare?.error || "Deploy failed — see the logs above.",
    onReset: reset, onUseForFleet: () => useForFleetDetection(), siemMsg,
  } : null;
  const deployHasCard = !!deployPath && existingLabs.some((l) => l.path === deployPath);

  const num = (v: number, set: (n: number) => void, min: number, step: number) => (
    <input type="number" value={v} min={min} step={step} disabled={running} onChange={(e) => set(Math.max(min, Number(e.target.value) || min))}
      className="w-20 px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent disabled:opacity-60" />
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Virtual Labs / VMs</p>
          <p className="text-xs text-muted-foreground mt-0.5">Local VM labs (Splunk + Windows) your fleet forwards to for real-time Simulation &amp; Detection — deploy one, then start, stop, or destroy it right here or from Manage Labs, just like your C2 servers. Click a lab to see its install info.</p>
        </div>
        {available && (
          <button onClick={loadExisting} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground shrink-0"><RefreshCw className="h-3 w-3" /> Refresh</button>
        )}
      </div>

      {!available ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> Local VM deploy is available on self-hosted installs only (PLATFORM_MODE=self-hosted) — it needs VirtualBox + Vagrant on this host.
        </div>
      ) : (
        <>
          {/* Full-width stack of deployed labs (horizontal rows, like Local Caldera) */}
          <div className="space-y-3">
            {existingLabs.map((lab) => (
              <LabCard
                key={lab.id} lab={lab} lcBusy={lcBusy} siemMsg={siemMsg}
                onLifecycle={manageLifecycle} onUseForFleet={useForFleetDetection}
                deploy={deployPath && lab.path === deployPath ? deployView : null}
              />
            ))}

            {/* Active build before the lab is registered — transient full-width row */}
            {deployPath && !deployHasCard && deployView && (
              <div className="rounded-xl border border-accent/40 bg-card px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent shrink-0"><Database className="h-4 w-4" /></span>
                  <span className="text-sm font-semibold text-foreground">Detection Lab (Splunk + Windows)</span>
                  <span className="ml-auto text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full border border-info/30 bg-info/10 text-info">{done ? "up" : failed ? "failed" : "deploying"}</span>
                </div>
                <DeployBody v={deployView} />
              </div>
            )}

            {/* Deploy a new lab — full-width dashed row */}
            {!deployPath && (
              <button onClick={() => setOpen((v) => !v)}
                className={cn("w-full rounded-xl border border-dashed p-4 flex items-center gap-3 text-left transition-colors",
                  open ? "border-accent/50 bg-accent/5" : "border-border hover:border-accent/40 hover:bg-card-hover")}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent shrink-0"><Plus className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">Deploy a lab</span>
                  <span className="block text-[11px] text-muted-foreground">Detection Lab — Splunk + Windows (SAR)</span>
                </span>
                <span className="ml-auto">{open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}</span>
              </button>
            )}
          </div>

          {existingLabs.length === 0 && !deployPath && !open && (
            <p className="text-[11px] text-muted-foreground">No VM labs yet — deploy the Detection Lab so your fleet endpoints have a Splunk to forward to for real-time detection.</p>
          )}

          {/* Deploy form (revealed by the "Deploy a lab" card) */}
          {open && !deployPath && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-accent" />
                <span className="text-sm font-semibold text-foreground">Detection Lab (Splunk + Windows)</span>
                <button onClick={() => setOpen(false)} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">Close</button>
              </div>
              <p className="text-[11px] text-muted-foreground">Reuses the proven SAR-minimal lab (Ubuntu Splunk Enterprise + a Windows host with Splunk UF + Sysmon). Splunk listens on <span className="font-mono">0.0.0.0</span>; VMs deploy under the project path. Choose resources + network, then deploy.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className="text-[11px] text-muted-foreground flex items-center gap-2"><Server className="h-3 w-3" /> Splunk RAM (MB) {num(splunkRam, setSplunkRam, 2048, 512)}</label>
                <label className="text-[11px] text-muted-foreground flex items-center gap-2">Splunk CPUs {num(splunkCpus, setSplunkCpus, 1, 1)}</label>
                <label className="text-[11px] text-muted-foreground flex items-center gap-2">Win RAM (MB) {num(winRam, setWinRam, 2048, 512)}</label>
                <label className="text-[11px] text-muted-foreground flex items-center gap-2">Win CPUs {num(winCpus, setWinCpus, 1, 1)}</label>
                <label className="text-[11px] text-muted-foreground flex items-center gap-2">Network base
                  <input value={networkBase} onChange={(e) => setNetworkBase(e.target.value.trim())} placeholder="192.168.56"
                    className="w-24 px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                </label>
                <label className="text-[11px] text-muted-foreground flex items-center gap-2">Splunk admin pw
                  <input value={adminPw} onChange={(e) => setAdminPw(e.target.value)}
                    className="w-32 px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                </label>
              </div>
              <p className="text-[10px] text-muted-foreground">Splunk will be at <span className="font-mono">https://{networkBase}.12:8089</span> (REST) / <span className="font-mono">http://{networkBase}.12:8000</span> (web). Keep the network base on a net your fleet endpoints reach (your host-only <span className="font-mono">192.168.56</span> is a good default).</p>
              <button onClick={deploy} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md bg-accent text-white hover:bg-[#60a5fa]">
                <Play className="h-3.5 w-3.5" /> Deploy detection lab
              </button>
              {error && <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">{error}</div>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Shared deploy view (progress + coffee + logs + done) ────────────────────
interface DeployView {
  progress: number; curLabel: string; mmss: string;
  running: boolean; done: boolean; failed: boolean; logs: string[];
  splunkIp: string; adminPw: string; deployPath: string; errorText: string;
  onReset: () => void; onUseForFleet: () => void; siemMsg: SiemMsg;
}

function DeployBody({ v }: { v: DeployView }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className={cn("font-medium", v.done ? "text-success" : v.failed ? "text-danger" : "text-foreground")}>
            {v.done ? "✓ Splunk lab is up" : v.failed ? "✗ Deploy failed" : v.curLabel}
          </span>
          <span className="text-muted-foreground font-mono">{v.progress}% · {v.mmss}</span>
        </div>
        <div className="h-2 rounded-full bg-muted/20 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-700", v.done ? "bg-success" : v.failed ? "bg-danger" : "bg-accent", v.running && "animate-pulse")} style={{ width: `${Math.max(v.progress, v.running ? 4 : 0)}%` }} />
        </div>
      </div>

      {v.running && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 flex items-start gap-3">
          <Coffee className="h-6 w-6 text-accent shrink-0 mt-0.5" />
          <div className="text-[11px] text-muted-foreground">
            <p className="text-foreground font-medium">Building your Splunk lab — grab a coffee ☕</p>
            <p className="mt-0.5">First build clones + provisions the VMs (Vagrant + Ansible) and typically takes <span className="text-foreground">10–20 minutes</span>. It runs on the server and keeps going even if you close this page — come back any time to see progress.</p>
          </div>
        </div>
      )}

      {v.logs.length > 0 && (
        <pre className="text-[10px] font-mono bg-background/60 border border-border rounded-md p-2 overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{v.logs.slice(-40).join("\n")}</pre>
      )}

      {v.failed && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">{v.errorText}</div>
      )}

      {v.done && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-success"><ShieldCheck className="h-4 w-4" /> Splunk lab is up</div>
          <p className="text-[11px] text-muted-foreground">Web: <span className="font-mono">http://{v.splunkIp}:8000</span> · admin / {v.adminPw}. Point your fleet endpoints' forwarders at <span className="font-mono">{v.splunkIp}:9997</span>.</p>
          <button onClick={v.onUseForFleet} className="inline-flex items-center gap-1.5 text-[11px] h-7 px-2.5 rounded bg-purple text-white hover:bg-purple/90"><ShieldCheck className="h-3 w-3" /> Use for fleet detection</button>
          {v.siemMsg?.id === "deploy" && <div className="text-[11px] text-foreground flex items-start gap-1.5"><Check className="h-3 w-3 text-success mt-0.5" /> {v.siemMsg.text}</div>}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="font-mono truncate">{v.deployPath}</span>
        {(v.done || v.failed) && <button onClick={v.onReset} className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"><RefreshCw className="h-3 w-3" /> New deploy</button>}
      </div>
    </div>
  );
}

// ─── One lab card (grid tile; click to expand install info) ──────────────────
function LabCard({ lab, lcBusy, siemMsg, onLifecycle, onUseForFleet, deploy }: {
  lab: LabInfo; lcBusy: string | null; siemMsg: SiemMsg;
  onLifecycle: (action: "stop" | "resume" | "destroy", lab: LabInfo) => void;
  onUseForFleet: (lab: LabInfo) => void;
  deploy?: DeployView | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const poweredOn = isPoweredOn(lab);
  const busy = (action: string) => lcBusy === `${lab.id}:${action}`;
  const anyBusy = !!lcBusy && lcBusy.startsWith(`${lab.id}:`);

  return (
    <div className={cn("rounded-xl border bg-card", open ? "border-accent/40" : "border-border")}>
      {/* Horizontal header: identity on the left, manage actions + toggle on the right */}
      <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent shrink-0"><Database className="h-5 w-5" /></span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{lab.name}</span>
            <span className={cn("text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full border", LAB_STATUS_STYLE(lab.status))}>{lab.status}</span>
            {deploy && deploy.running && <span className="inline-flex items-center gap-1 text-[10px] text-info"><Loader2 className="h-3 w-3 animate-spin" /> {deploy.progress}%</span>}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{lab.vmNames.length} VM{lab.vmNames.length === 1 ? "" : "s"}{lab.type ? ` · ${lab.type}` : ""}</div>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {poweredOn ? (
            <button onClick={() => onLifecycle("stop", lab)} disabled={anyBusy} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">{busy("stop") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} Stop</button>
          ) : (
            <button onClick={() => onLifecycle("resume", lab)} disabled={anyBusy} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded bg-success/90 text-white hover:bg-success disabled:opacity-50">{busy("resume") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start</button>
          )}
          {lab.status === "running" && lab.accessUrl && (
            <a href={lab.accessUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-accent/40 text-accent hover:bg-accent/10"><ExternalLink className="h-3 w-3" /> Open Splunk</a>
          )}
          {confirmDestroy ? (
            <span className="inline-flex items-center gap-1.5">
              <button onClick={() => { setConfirmDestroy(false); onLifecycle("destroy", lab); }} disabled={anyBusy} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded bg-danger text-white hover:bg-danger/90 disabled:opacity-50">{busy("destroy") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Confirm</button>
              <button onClick={() => setConfirmDestroy(false)} className="text-[11px] text-muted-foreground">cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDestroy(true)} disabled={anyBusy} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded text-danger hover:bg-danger/10 disabled:opacity-50"><Trash2 className="h-3 w-3" /> Destroy</button>
          )}
          <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} {deploy ? "Logs & info" : "Details"}
          </button>
        </div>
      </div>

      {busy("destroy") && <p className="px-4 pb-2 -mt-1 text-[10px] text-muted-foreground">Destroying VMs + removing the deploy — this can take a minute…</p>}

      {/* Collapsible: deploy progress/logs (if this lab is mid/just-deployed) + install info */}
      {open && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
          {deploy && <DeployBody v={deploy} />}
          <div className="space-y-2">
            <div className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">Path:</span> <span className="font-mono break-all">{lab.path}</span>
            </div>
            {lab.accessUrl && (
              <div className="text-[10px] text-muted-foreground"><span className="font-medium text-foreground">Access:</span> <span className="font-mono">{lab.accessUrl}</span></div>
            )}
            <div className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">VMs:</span>
              <div className="mt-1 rounded-md border border-border overflow-hidden divide-y divide-border">
                {(lab.vms.length ? lab.vms : lab.vmNames).map((v, i) => (
                  <div key={i} className="px-2 py-1 font-mono text-[10px] text-muted-foreground bg-background/40 break-all">{v}</div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {lab.status === "running" && (
                <button onClick={() => onUseForFleet(lab)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded bg-purple text-white hover:bg-purple/90"><ShieldCheck className="h-3 w-3" /> Use for fleet detection</button>
              )}
              <Link href="/manage-labs?tab=local" className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover"><Wrench className="h-3 w-3" /> Manage Labs</Link>
            </div>
            {siemMsg?.id === lab.id && <div className="text-[11px] text-foreground flex items-start gap-1.5"><Check className="h-3 w-3 text-success mt-0.5" /> {siemMsg.text}</div>}
            <p className="text-[10px] text-muted-foreground">Fleet endpoints forward telemetry here (<span className="font-mono">:9997</span>); the platform queries it for real-time detection. Stop it when idle to free memory/disk.</p>
          </div>
        </div>
      )}
    </div>
  );
}
