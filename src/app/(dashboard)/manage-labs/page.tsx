"use client";

/**
 * Manage Labs — safe teardown of everything the user has stood up:
 *   • Local Lab   → VirtualBox/Vagrant deployments (real destroy + registry removal)
 *   • Cloud Lab   → SAR attack-ranges in the user's cloud (real destroy)
 *   • Remote Fleet→ enrolled nodes (revoke = agent stops) + whole-fleet cascade delete
 *
 * Every destructive action is two-step (click → confirm) and reports what it did.
 * Nothing here just hides a row: local calls the deploy `destroy` action, cloud
 * calls the SAR destroy proxy, and fleet delete/revoke hit the fleet APIs.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Server, Cloud, Cpu, Trash2, Loader2, RefreshCw, AlertTriangle, ShieldOff,
  CheckCircle2, XCircle, ChevronDown, ChevronRight, Boxes, FolderOpen, Play, Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { sarListRanges, sarDestroyRange, sarAbortRange, SarError } from "@/lib/sar-client";
import { isSarTerminal, type SarOperationStatus } from "@/types/sar";

type Tab = "local" | "cloud" | "fleet";

export default function ManageLabsPage() {
  const [tab, setTab] = useState<Tab>("local");

  // Honor a ?tab= deep-link (used by the sidebar's Manage Labs entries).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "local" || t === "cloud" || t === "fleet") setTab(t);
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Trash2 className="h-6 w-6 text-accent" /> Manage Labs
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Safely remove labs you&apos;ve created — local VMs, cloud ranges, or fleet agents. Teardown is real:
          VMs are destroyed, cloud resources are released, and fleet agents are stopped on their endpoints.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        <TabBtn active={tab === "local"} onClick={() => setTab("local")} Icon={Server} label="Local Labs" />
        <TabBtn active={tab === "cloud"} onClick={() => setTab("cloud")} Icon={Cloud} label="Cloud Labs" />
        <TabBtn active={tab === "fleet"} onClick={() => setTab("fleet")} Icon={Cpu} label="Remote Fleet" />
      </div>

      {tab === "local" && <LocalLabs />}
      {tab === "cloud" && <CloudLabs />}
      {tab === "fleet" && <FleetLabs />}
    </div>
  );
}

function TabBtn({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: any; label: string }) {
  return (
    <button onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
        active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

// Two-step destructive button: first click arms it, second click fires.
function DangerButton({ label, confirmLabel, onConfirm, busy, disabled, title }: {
  label: string; confirmLabel: string; onConfirm: () => void; busy?: boolean; disabled?: boolean; title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  if (busy) {
    return <span className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border px-2.5 py-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Working…</span>;
  }
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} disabled={disabled} title={title}
        className="inline-flex items-center gap-1 text-[11px] rounded-md border border-danger/40 px-2.5 py-1 text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed">
        <Trash2 className="h-3 w-3" /> {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={() => { setArmed(false); onConfirm(); }}
        className="inline-flex items-center gap-1 text-[11px] rounded-md bg-danger text-white px-2.5 py-1 hover:bg-danger/90">
        <AlertTriangle className="h-3 w-3" /> {confirmLabel}
      </button>
      <button onClick={() => setArmed(false)} className="text-[11px] text-muted-foreground hover:text-foreground px-1.5">Cancel</button>
    </span>
  );
}

function Notice({ kind, children }: { kind: "info" | "error" | "ok"; children: React.ReactNode }) {
  const cls = kind === "error" ? "border-danger/30 bg-danger/10 text-danger"
    : kind === "ok" ? "border-success/30 bg-success/10 text-success"
    : "border-border bg-card/40 text-muted-foreground";
  const Icon = kind === "error" ? XCircle : kind === "ok" ? CheckCircle2 : AlertTriangle;
  return <div className={cn("rounded-lg border px-3 py-2 text-[11px] inline-flex items-start gap-2", cls)}><Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" /><div className="space-y-0.5">{children}</div></div>;
}

const STATUS_STYLE: Record<string, string> = {
  running: "border-success/30 bg-success/10 text-success",
  online: "border-success/30 bg-success/10 text-success",
  stopped: "border-border bg-muted/10 text-muted-foreground",
  offline: "border-border bg-muted/10 text-muted-foreground",
  partial: "border-warning/30 bg-warning/10 text-warning",
  installed: "border-info/30 bg-info/10 text-info",
  missing: "border-danger/30 bg-danger/10 text-danger",
  revoked: "border-danger/30 bg-danger/10 text-danger",
  paused: "border-info/30 bg-info/10 text-info",
};

// ─── Local Labs ──────────────────────────────────────────────────────────────
interface InstalledEnv {
  id: string; name: string; templateName?: string; type: string; status: string;
  path: string; vms: string[]; vmNames?: string[]; templateId?: string;
}

function LocalLabs() {
  const [envs, setEnvs] = useState<InstalledEnv[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; lines: string[] } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/detection-lab/system-info").then((r) => r.json())
      .then((d) => setEnvs(d.installedEnvironments || [])).catch(() => setEnvs([])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Platform-managed deploy: real `destroy` action (VMs + files + registry).
  const destroy = async (env: InstalledEnv) => {
    setBusy(env.id); setResult(null);
    try {
      const r = await fetch("/api/detection-lab/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "destroy", deployPath: env.path }),
      });
      const j = await r.json();
      setResult({ id: env.id, ok: r.ok && j.success !== false, lines: j.results || [j.error || (r.ok ? "Destroyed" : "Failed")] });
    } catch (e: any) {
      setResult({ id: env.id, ok: false, lines: [e?.message || String(e)] });
    } finally { setBusy(null); load(); }
  };

  // Managed deploy: manual stop/start of the lab server (powers VMs off/on
  // without destroying). Lets the user run their infra only when they want it.
  const lifecycle = async (env: InstalledEnv, action: "stop" | "resume") => {
    setBusy(env.id); setResult(null);
    try {
      const r = await fetch("/api/detection-lab/deploy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, deployPath: env.path }),
      });
      const j = await r.json();
      setResult({ id: env.id, ok: r.ok && j.success !== false, lines: j.results || [j.error || (r.ok ? "Done" : "Failed")] });
    } catch (e: any) {
      setResult({ id: env.id, ok: false, lines: [e?.message || String(e)] });
    } finally { setBusy(null); load(); }
  };

  // Source-tree install (no deployment.json): start/stop by driving each VM
  // directly through the per-VM endpoint (start = boot headless; stop = poweroff).
  // This is what lets a GOAD (or any source-installed) lab be started/stopped here.
  const sourceLifecycle = async (env: InstalledEnv, action: "start" | "poweroff") => {
    const names = env.vmNames || [];
    if (!names.length) { setResult({ id: env.id, ok: false, lines: ["No VMs registered in VirtualBox for this install."] }); return; }
    setBusy(env.id); setResult(null);
    const lines: string[] = [];
    let ok = true;
    for (const vmName of names) {
      try {
        const r = await fetch("/api/detection-lab/vm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vmName, action }),
        });
        const j = await r.json();
        if (r.ok) lines.push(j.message || `${vmName}: ${j.state || (action === "start" ? "started" : "stopped")}`);
        else { ok = false; lines.push(`${vmName}: ${j.error || `${action} failed`}`); }
      } catch (e: any) { ok = false; lines.push(`${vmName}: ${e?.message || String(e)}`); }
    }
    setResult({ id: env.id, ok, lines });
    setBusy(null); load();
  };

  // Source-tree install (no deployment.json): remove by deleting each VM from
  // VirtualBox — that's what makes it drop out of the platform everywhere.
  const removeSourceVMs = async (env: InstalledEnv) => {
    const names = env.vmNames || [];
    setBusy(env.id); setResult(null);
    const lines: string[] = [];
    let ok = true;
    if (!names.length) { setResult({ id: env.id, ok: false, lines: ["No VMs registered in VirtualBox for this install."] }); setBusy(null); return; }
    for (const vmName of names) {
      try {
        const r = await fetch("/api/detection-lab/vm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vmName, action: "delete" }),
        });
        const j = await r.json();
        if (r.ok) lines.push(...(j.results || [`Deleted ${vmName}`]));
        else { ok = false; lines.push(`${vmName}: ${j.error || "delete failed"}`); }
      } catch (e: any) { ok = false; lines.push(`${vmName}: ${e?.message || String(e)}`); }
    }
    setResult({ id: env.id, ok, lines });
    setBusy(null); load();
  };

  if (loading) return <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!envs.length) return <EmptyState icon={Server} title="No local labs installed" sub="Deploy a Local Lab from the Deploy hub to see it here." />;

  return (
    <div className="space-y-2">
      <RefreshRow onClick={load} />
      {envs.map((env) => {
        const managed = !!env.templateId;      // registry-tracked deploy → safe to destroy
        // Decide Stop vs Start from whether VMs are actually powered on — NOT from
        // the reachability-gated status. A lab can read "unreachable" (VMs up, but
        // Splunk not answering yet) or "partial"; those still have running VMs the
        // user must be able to Stop. Only fully-off labs offer Start.
        const anyRunning = (env.vms || []).some((v) => /running/i.test(v)) || ["running", "unreachable", "partial"].includes(env.status);
        const anyOff = (env.vms || []).some((v) => /(poweroff|powered off|stopped|saved|aborted|missing)/i.test(v)) || ["stopped", "missing", "installed"].includes(env.status);
        return (
          <div key={env.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Server className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium text-foreground">{env.name}</span>
              <span className={cn("inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLE[env.status] || STATUS_STYLE.installed)}>{env.status}</span>
              <span className="text-[10px] text-muted-foreground">{(env.vmNames || []).length} VM</span>
              <div className="ml-auto flex items-center gap-2">
                {managed ? (
                  <>
                    {anyRunning && (
                      <button onClick={() => lifecycle(env, "stop")} disabled={busy === env.id}
                        title="Power off this lab's VMs (keeps them — resume later)"
                        className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">
                        {busy === env.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} Stop
                      </button>
                    )}
                    {(anyOff || !anyRunning) && (
                      <button onClick={() => lifecycle(env, "resume")} disabled={busy === env.id}
                        title="Power this lab's VMs back on"
                        className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded bg-success/90 text-white hover:bg-success disabled:opacity-50">
                        {busy === env.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start
                      </button>
                    )}
                    <DangerButton
                      label="Destroy" confirmLabel="Destroy VMs + files" busy={busy === env.id}
                      title="Runs vagrant/SAR destroy, deletes the deploy dir, and unregisters it"
                      onConfirm={() => destroy(env)} />
                  </>
                ) : (
                  <>
                    {anyRunning && (
                      <button onClick={() => sourceLifecycle(env, "poweroff")} disabled={busy === env.id || !(env.vmNames || []).length}
                        title="Power off each VM of this source install (keeps them — start again later)"
                        className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">
                        {busy === env.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} Stop
                      </button>
                    )}
                    {(anyOff || !anyRunning) && (
                      <button onClick={() => sourceLifecycle(env, "start")} disabled={busy === env.id || !(env.vmNames || []).length}
                        title="Boot each VM of this source install (headless)"
                        className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded bg-success/90 text-white hover:bg-success disabled:opacity-50">
                        {busy === env.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start
                      </button>
                    )}
                    <DangerButton
                      label="Remove VMs" confirmLabel="Delete VMs from VirtualBox" busy={busy === env.id}
                      disabled={!(env.vmNames || []).length}
                      title="Powers off and unregisters (--delete) each VM of this source install"
                      onConfirm={() => removeSourceVMs(env)} />
                  </>
                )}
              </div>
            </div>
            {env.templateName && <div className="mt-1 text-[10px] text-muted-foreground inline-flex items-center gap-1"><Boxes className="h-3 w-3" /> Template: <span className="text-foreground">{env.templateName}</span></div>}
            {env.path && <div className="mt-0.5 text-[10px] text-muted-foreground inline-flex items-center gap-1"><FolderOpen className="h-3 w-3 shrink-0" /> Path: <span className="text-foreground font-mono break-all">{env.path}</span></div>}
            {env.vms?.length ? <div className="mt-0.5 text-[10px] text-muted-foreground font-mono break-all">VMs: {env.vms.join(" · ")}</div> : null}
            {!managed && <div className="mt-1 text-[10px] text-muted-foreground">Source-tree install (not platform-managed) — “Remove VMs” deletes its VMs from VirtualBox so it no longer appears across the platform. The source directory on disk is left untouched.</div>}
            {result?.id === env.id && (
              <div className="mt-2"><Notice kind={result.ok ? "ok" : "error"}>{result.lines.map((l, i) => <div key={i}>{l}</div>)}</Notice></div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Cloud Labs ──────────────────────────────────────────────────────────────
function CloudLabs() {
  const [ranges, setRanges] = useState<SarOperationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    sarListRanges().then((d) => setRanges(d.attack_ranges || []))
      .catch((e) => setErr(e instanceof SarError ? `Cloud controller unreachable (${e.status}). Start it from Deploy → Cloud Lab.` : (e?.message || String(e))))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rangeId = (r: SarOperationStatus) => r.attack_range_id || r.attack_range_name || "";

  const destroy = async (r: SarOperationStatus) => {
    const rid = rangeId(r);
    setBusy(rid); setMsg(null);
    try {
      const inProgress = !isSarTerminal(r.status);
      const res = inProgress ? await sarAbortRange({ attack_range_id: rid }) : await sarDestroyRange({ attack_range_id: rid });
      setMsg({ id: rid, ok: true, text: res.message || (inProgress ? "Build aborted" : "Range destroyed") });
    } catch (e: any) {
      setMsg({ id: rid, ok: false, text: e instanceof SarError ? (e.message || `HTTP ${e.status}`) : (e?.message || String(e)) });
    } finally { setBusy(null); load(); }
  };

  if (loading) return <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (err) return <div className="space-y-2"><RefreshRow onClick={load} /><Notice kind="info">{err}</Notice></div>;
  if (!ranges.length) return <div className="space-y-2"><RefreshRow onClick={load} /><EmptyState icon={Cloud} title="No cloud ranges" sub="Build a Cloud Lab from the Deploy hub to see it here." /></div>;

  return (
    <div className="space-y-2">
      <RefreshRow onClick={load} />
      {ranges.map((r) => {
        const rid = rangeId(r);
        const inProgress = !isSarTerminal(r.status);
        return (
          <div key={rid} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Cloud className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium text-foreground">{r.attack_range_name || rid || "(unnamed)"}</span>
              <span className={cn("inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLE[r.status] || STATUS_STYLE.installed)}>{r.status}</span>
              {r.template_name && <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Boxes className="h-3 w-3" /> {r.template_name}</span>}
              <div className="ml-auto">
                <DangerButton
                  label={inProgress ? "Abort build" : "Destroy"} confirmLabel={inProgress ? "Abort now" : "Destroy cloud range"}
                  busy={busy === rid} disabled={!rid} title={rid ? undefined : "Range has no id"}
                  onConfirm={() => destroy(r)} />
              </div>
            </div>
            {r.router_public_ip && <div className="mt-1 text-[10px] text-muted-foreground font-mono">router {r.router_public_ip}</div>}
            {msg?.id === rid && <div className="mt-2"><Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice></div>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Remote Fleet ────────────────────────────────────────────────────────────
interface FleetListItem { id: string; name: string; nodeCount: number; onlineCount: number; }
interface FleetNode { id: string; hostname?: string; name?: string; os?: string; liveness?: string; status?: string; }

interface C2ListItem { id: string; name: string; provider: string; mode: string; url: string; status: string; deploymentId: string | null; }

function FleetLabs() {
  const [fleets, setFleets] = useState<FleetListItem[]>([]);
  const [c2s, setC2s] = useState<C2ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Record<string, FleetNode[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [highlightC2, setHighlightC2] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/fleets").then((r) => r.json()).then((d) => setFleets(d.items || [])).catch(() => setFleets([])),
      fetch("/api/c2").then((r) => r.json()).then((d) => setC2s(d.items || [])).catch(() => setC2s([])),
    ]).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep-link from the Fleet Simulation hub's "Manage" button: ?c2=<id>.
  useEffect(() => {
    try {
      const cid = new URLSearchParams(window.location.search).get("c2");
      if (cid) { setHighlightC2(cid); setTimeout(() => document.getElementById(`c2-${cid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150); }
    } catch { /* ignore */ }
  }, []);

  const deleteC2 = async (id: string) => {
    setBusy(`c2:${id}`); setMsg(null);
    try {
      const r = await fetch(`/api/c2/${id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      setMsg({ id, ok: r.ok, text: r.ok ? `C2 server removed — ${j.teardown || "done"}.` : (j.error || "Delete failed") });
    } catch (e: any) { setMsg({ id, ok: false, text: e?.message || String(e) }); }
    finally { setBusy(null); load(); }
  };

  // Deep-link from the Fleet Simulation page's "Manage" button:
  // /manage-labs?tab=fleet&fleet=<id> auto-expands (and scrolls to) that fleet.
  useEffect(() => {
    try {
      const fid = new URLSearchParams(window.location.search).get("fleet");
      if (fid) {
        setExpanded(fid);
        loadNodes(fid);
        setTimeout(() => document.getElementById(`fleet-${fid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNodes = useCallback(async (fleetId: string) => {
    try {
      const r = await fetch(`/api/fleets/${fleetId}`);
      const j = await r.json();
      setNodes((prev) => ({ ...prev, [fleetId]: j.nodes || [] }));
    } catch { setNodes((prev) => ({ ...prev, [fleetId]: [] })); }
  }, []);

  const toggle = (fleetId: string) => {
    const next = expanded === fleetId ? null : fleetId;
    setExpanded(next);
    if (next && !nodes[next]) loadNodes(next);
  };

  const revokeNode = async (fleetId: string, nodeId: string) => {
    setBusy(`node:${nodeId}`); setMsg(null);
    try {
      const r = await fetch(`/api/fleets/${fleetId}/nodes/${nodeId}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      setMsg({ id: fleetId, ok: r.ok, text: r.ok ? "Node revoked — its agent stops on the next heartbeat." : (j.error || "Revoke failed") });
    } catch (e: any) { setMsg({ id: fleetId, ok: false, text: e?.message || String(e) }); }
    finally { setBusy(null); loadNodes(fleetId); load(); }
  };

  const deleteFleet = async (fleetId: string) => {
    setBusy(`fleet:${fleetId}`); setMsg(null);
    try {
      // cascade=1 removes every node (stopping each agent), tokens, campaigns, and history.
      const r = await fetch(`/api/fleets/${fleetId}?cascade=1`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      setMsg({ id: fleetId, ok: r.ok, text: r.ok ? `Fleet deleted — ${j.removedNodes ?? 0} node(s) removed and stopped.` : (j.error || "Delete failed") });
    } catch (e: any) { setMsg({ id: fleetId, ok: false, text: e?.message || String(e) }); }
    finally { setBusy(null); load(); }
  };

  if (loading) return <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!fleets.length && !c2s.length) return <EmptyState icon={Cpu} title="No fleets or C2 servers" sub="Stand up a C2 or enroll endpoints from Deploy → Remote Fleet to see them here." />;

  return (
    <div className="space-y-2">
      <RefreshRow onClick={load} />

      {/* C2 servers (Caldera / Sliver / OpenBAS) */}
      {c2s.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">C2 servers</p>
          <Notice kind="info">
            <div><span className="text-foreground font-medium">Delete C2</span> removes the server. A <span className="font-medium">deployed</span> C2 is torn down (its Docker container stops and is removed); a <span className="font-medium">connected</span> one is simply forgotten. The backing simulation target is removed either way.</div>
          </Notice>
          {c2s.map((c) => (
            <div key={c.id} id={`c2-${c.id}`} className={cn("rounded-lg border bg-card p-3 flex items-center gap-2 flex-wrap", highlightC2 === c.id ? "border-accent/60" : "border-border")}>
              <Cpu className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium text-foreground">{c.name}</span>
              <span className="text-[10px] uppercase text-muted-foreground">{c.provider} · {c.mode === "managed" ? "deployed" : "connected"}</span>
              <span className={cn("inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLE[c.status] || STATUS_STYLE.offline)}>{c.status}</span>
              {c.url && <span className="text-[10px] text-muted-foreground font-mono">{c.url}</span>}
              <div className="ml-auto">
                <DangerButton label="Delete C2" confirmLabel={c.mode === "managed" ? "Tear down + remove" : "Forget C2"} busy={busy === `c2:${c.id}`} onConfirm={() => deleteC2(c.id)} />
              </div>
              {msg?.id === c.id && <div className="w-full"><Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice></div>}
            </div>
          ))}
        </div>
      )}

      {fleets.length > 0 && <p className="text-xs font-medium text-foreground pt-2">Native agent fleets</p>}
      {fleets.length > 0 && (
        <Notice kind="info">
          <div><span className="text-foreground font-medium">Revoke a node</span> to stop just that agent once its simulation is done — the endpoint&apos;s agent exits on its next heartbeat.</div>
          <div><span className="text-foreground font-medium">Delete fleet</span> tears the whole fleet down: every node is removed and stopped, along with its tokens and run history.</div>
        </Notice>
      )}
      {fleets.map((f) => {
        const open = expanded === f.id;
        const fleetNodes = nodes[f.id] || [];
        return (
          <div key={f.id} id={`fleet-${f.id}`} className={cn("rounded-lg border bg-card", open ? "border-accent/50" : "border-border")}>
            <div className="flex items-center gap-2 flex-wrap p-3">
              <button onClick={() => toggle(f.id)} className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Cpu className="h-4 w-4 text-accent" /> {f.name}
              </button>
              <span className="text-[10px] text-muted-foreground">{f.nodeCount} node(s) · {f.onlineCount} online</span>
              <div className="ml-auto">
                <DangerButton label="Delete fleet" confirmLabel="Delete + stop all agents" busy={busy === `fleet:${f.id}`}
                  onConfirm={() => deleteFleet(f.id)} />
              </div>
            </div>
            {msg?.id === f.id && <div className="px-3 pb-2"><Notice kind={msg.ok ? "ok" : "error"}>{msg.text}</Notice></div>}
            {open && (
              <div className="border-t border-border p-3 space-y-1.5">
                {!nodes[f.id] ? (
                  <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading nodes…</div>
                ) : fleetNodes.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">No nodes enrolled.</div>
                ) : fleetNodes.map((n) => {
                  const st = n.liveness || n.status || "offline";
                  const revoked = n.status === "revoked";
                  return (
                    <div key={n.id} className="flex items-center gap-2 flex-wrap rounded-md bg-background/40 px-2.5 py-1.5">
                      <span className="text-[11px] text-foreground font-mono">{n.hostname || n.name || n.id.slice(0, 8)}</span>
                      {n.os && <span className="text-[10px] text-muted-foreground">{n.os}</span>}
                      <span className={cn("inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border", STATUS_STYLE[st] || STATUS_STYLE.offline)}>{st}</span>
                      <div className="ml-auto">
                        {revoked ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldOff className="h-3 w-3" /> revoked</span>
                        ) : (
                          <DangerButton label="Revoke" confirmLabel="Revoke agent" busy={busy === `node:${n.id}`}
                            onConfirm={() => revokeNode(f.id, n.id)} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────
function RefreshRow({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover">
        <RefreshCw className="h-3 w-3" /> Refresh
      </button>
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
      <Icon className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
