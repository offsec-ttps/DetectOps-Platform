"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Cpu, Plus, Loader2, RefreshCw, Inbox, Trash2, KeyRound, Copy, Check, AlertTriangle,
  CheckCircle2, ChevronRight, ChevronDown, ArrowLeft, ShieldCheck, ShieldAlert, X, Terminal,
  Play, Pause, Wrench, FlaskConical, XCircle, Clock, Download, Swords, Server, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SimulationWizard, { LiveRun } from "@/components/bas/SimulationWizard";

interface FleetRow { id: string; name: string; nodeCount: number; onlineCount: number; allowedScope: string[]; createdAt: string }
interface NodeRow {
  id: string; name: string; hostname: string; os: string; osVersion: string; arch: string;
  agentVersion: string; status: string; liveness: "online" | "stale" | "offline" | "revoked" | "paused";
  lastSeen: string | null; hostStatus: Record<string, any>; createdAt: string;
}
interface TokenRow { id: string; label: string; allowedScope: string[]; expiresAt: string; usedCount: number; maxUses: number; revoked: boolean; expired: boolean; createdAt: string }
interface ConsentStatus { state: "valid" | "expired" | "pending"; validTo: string | null; authorizedBy: string; scopes: string[] }
interface FleetDetail { id: string; name: string; allowedScope: string[]; nodes: NodeRow[]; tokens: TokenRow[]; consent?: ConsentStatus | null }

const LIVENESS: Record<NodeRow["liveness"], { label: string; color: string; dot: string }> = {
  online:  { label: "online",  color: "text-success", dot: "bg-success" },
  stale:   { label: "stale",   color: "text-warning", dot: "bg-warning" },
  offline: { label: "offline", color: "text-muted-foreground", dot: "bg-muted" },
  revoked: { label: "revoked", color: "text-danger", dot: "bg-danger" },
  paused:  { label: "paused",  color: "text-info", dot: "bg-info" },
};

type FleetTab = "simulate" | "servers" | "history";

export default function FleetPage() {
  const [fleets, setFleets] = useState<FleetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fleetId, setFleetId] = useState<string>("");
  const [tab, setTab] = useState<FleetTab>("simulate");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [vaultEphemeral, setVaultEphemeral] = useState(false);

  const loadFleets = async () => {
    try {
      const r = await fetch("/api/fleets");
      const d = await r.json();
      const items = d.items || [];
      setFleets(items);
      setVaultEphemeral(!!d.vaultEphemeral);
      // Default the selected fleet to one that actually has a live endpoint, so
      // an online node isn't hidden behind a newer-but-empty fleet. Preference:
      // a fleet with online nodes → any fleet with enrolled nodes → newest.
      setFleetId((cur) => {
        if (cur) return cur;
        const withOnline = items.find((f: FleetRow) => (f.onlineCount ?? 0) > 0);
        const withNodes = items.find((f: FleetRow) => (f.nodeCount ?? 0) > 0);
        return (withOnline || withNodes || items[0])?.id ?? "";
      });
    } finally { setLoading(false); }
  };
  useEffect(() => { loadFleets(); }, []);

  const createFleet = async () => {
    if (!newName.trim()) return;
    setError(null);
    const r = await fetch("/api/fleets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const d = await r.json();
    if (!r.ok) { setError(d.error || "create failed"); return; }
    setNewName(""); setCreating(false);
    await loadFleets();
    setFleetId(d.id);
    setTab("servers");
  };

  const activeFleet = fleets.find((f) => f.id === fleetId);

  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const TABS: Array<{ key: FleetTab; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
    { key: "simulate", label: "Simulate", Icon: Swords },
    { key: "servers", label: "Servers", Icon: Server },
    { key: "history", label: "History", Icon: History },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cpu className="h-6 w-6 text-accent" /> Fleet Simulation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run Atomic Red Team techniques on your live endpoints and score detection against your SIEM — step by step.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5">
          {fleets.length > 0 && (
            <select value={fleetId} onChange={(e) => setFleetId(e.target.value)} className="h-9 px-2 text-xs rounded-md border border-border bg-input text-foreground">
              {fleets.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.onlineCount}/{f.nodeCount} online)</option>)}
            </select>
          )}
          {fleetId && (
            <Link href={`/manage-labs?tab=fleet&fleet=${fleetId}`}
              title="Manage this fleet — delete/remove the fleet server and its endpoints"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md border border-border text-foreground hover:bg-card-hover">
              <Wrench className="h-3.5 w-3.5" /> Manage
            </Link>
          )}
          <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]">
            <Plus className="h-3.5 w-3.5" /> New fleet
          </button>
        </div>
      </div>

      {vaultEphemeral && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-foreground">Enrollments won&apos;t survive a server restart</p>
            <p className="mt-0.5 text-muted-foreground">
              <span className="font-mono">CREDENTIAL_VAULT_KEY</span> is not set, so node keys are encrypted with an
              ephemeral key. After the server restarts, enrolled agents fail authentication and go permanently offline.
              Set a stable <span className="font-mono">CREDENTIAL_VAULT_KEY</span> in <span className="font-mono">.env</span>,
              restart the app, then re-enroll nodes with a fresh token.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}
      {creating && (
        <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFleet()}
            placeholder="Fleet name (e.g. acme-corp-windows)" className="flex-1 px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
          <button onClick={createFleet} disabled={!newName.trim()} className="h-8 px-3 text-xs rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">Create</button>
          <button onClick={() => { setCreating(false); setNewName(""); }} className="h-8 px-2 text-xs rounded border border-border text-muted-foreground">Cancel</button>
        </div>
      )}

      {fleets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No fleets yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">Create a fleet, then enroll endpoints to run on-host simulations.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-border">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={cn(
                "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
                tab === t.key ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <t.Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {tab === "simulate" && fleetId && <SimulationWizard key={fleetId} fleetId={fleetId} onDone={loadFleets} />}
          {tab === "servers" && fleetId && <FleetDetailView key={fleetId} fleetId={fleetId} />}
          {tab === "history" && fleetId && <HistoryTab key={fleetId} fleetId={fleetId} />}
        </>
      )}
    </div>
  );
}

// ─── History tab: past campaigns → live detail ──────────────────────────────
function HistoryTab({ fleetId }: { fleetId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    const r = await fetch(`/api/fleets/${fleetId}/campaigns`);
    const d = await r.json();
    setItems(d.items || []); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fleetId]);

  if (open) return <LiveRun fleetId={fleetId} campaignId={open} mode="sim" techniques={[]} onClose={() => { setOpen(null); load(); }} />;
  if (loading) return <div className="py-6 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (items.length === 0) return <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center text-xs text-muted-foreground">No simulations run yet. Use the <span className="font-medium">Simulate</span> tab.</div>;

  const SC: Record<string, string> = { running: "text-info", completed: "text-success", failed: "text-danger", halted: "text-warning" };
  return (
    <div className="space-y-2">
      {items.map((c) => {
        const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
        return (
          <button key={c.id} onClick={() => setOpen(c.id)} className="w-full text-left rounded-xl border border-border bg-card hover:bg-card-hover px-4 py-3 flex items-center gap-3">
            <Swords className="h-5 w-5 text-accent flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-foreground truncate">{c.testSelection.map((t: any) => t.testName || `${t.technique} #${t.testIndex}`).slice(0, 3).join(", ")}</span>
                <span className={cn("text-[10px] uppercase font-bold", SC[c.status] || "text-muted-foreground")}>{c.status}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted/20 overflow-hidden max-w-xs"><div className={cn("h-full rounded-full", c.status === "completed" ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} /></div>
                <span className="text-[10px] text-muted-foreground">{c.progress.done}/{c.progress.total} ops</span>
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

function FleetDetailView({ fleetId }: { fleetId: string }) {
  const [detail, setDetail] = useState<FleetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`/api/fleets/${fleetId}`);
      if (!r.ok) {
        // Don't overwrite a good detail on a transient/poll error; just surface it.
        setLoadError(r.status === 401 ? "Not authorized to view this fleet." : `Failed to load fleet (HTTP ${r.status}).`);
        setLoading(false);
        return;
      }
      const d = await r.json();
      if (!d || !Array.isArray(d.nodes)) { setLoadError("Unexpected response from server."); setLoading(false); return; }
      setDetail({ ...d, nodes: d.nodes || [], tokens: d.tokens || [] });
      setLoadError(null);
      setLoading(false);
    } catch {
      setLoadError("Failed to load fleet.");
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // Live-refresh node liveness every 4s so a node going online appears promptly.
    pollRef.current = setInterval(load, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetId]);

  const revokeNode = async (nodeId: string) => {
    if (!confirm("Revoke this node? Its next heartbeat gets 401 and the agent stops.")) return;
    await fetch(`/api/fleets/${fleetId}/nodes/${nodeId}`, { method: "DELETE" });
    await load();
  };

  if (loading) {
    return <div className="py-6 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (!detail) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {loadError || "Fleet not found."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {detail.nodes.length} endpoint(s) · {detail.nodes.filter((n) => n.liveness === "online").length} online — enroll, authorize, and manage your fleet's servers here.
        </p>
        <button onClick={() => setEnrolling(true)} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]">
          <Plus className="h-3.5 w-3.5" /> Enroll a node
        </button>
      </div>

      {enrolling && (
        <EnrollNodeStepper fleetId={fleetId} onClose={() => { setEnrolling(false); load(); }} />
      )}

      {/* Consent banner — authorization to run adversary techniques on this fleet */}
      <ConsentBanner fleetId={fleetId} consent={detail.consent} allowedScope={detail.allowedScope} onChange={load} />

      {/* Nodes */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2 border-b border-border text-xs font-semibold text-foreground">Nodes</div>
        {detail.nodes.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No nodes enrolled. Click <span className="font-mono">Enroll a node</span> to add an endpoint.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {detail.nodes.map((n) => (
              <NodeRowItem key={n.id} fleetId={fleetId} node={n} onRevoke={() => revokeNode(n.id)} onRefresh={load} />
            ))}
          </div>
        )}
      </div>

      {/* Tokens */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2 border-b border-border text-xs font-semibold text-foreground inline-flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" /> Enrollment tokens
        </div>
        {detail.tokens.length === 0 ? (
          <div className="px-4 py-4 text-center text-[11px] text-muted-foreground">No tokens. Mint one via "Enroll a node".</div>
        ) : (
          <div className="divide-y divide-border">
            {detail.tokens.map((t) => (
              <div key={t.id} className="px-4 py-2 flex items-center gap-2 text-[11px]">
                <KeyRound className="h-3 w-3 text-muted-foreground" />
                <span className="text-foreground">{t.label || "(unlabeled)"}</span>
                <span className="text-muted-foreground">· used {t.usedCount}{t.maxUses ? `/${t.maxUses}` : ""}</span>
                <span className={cn("text-[10px] uppercase font-bold ml-auto",
                  t.revoked ? "text-danger" : t.expired ? "text-warning" : "text-success")}>
                  {t.revoked ? "revoked" : t.expired ? "expired" : "active"}
                </span>
                <span className="text-[10px] text-muted-foreground">exp {new Date(t.expiresAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TestRun {
  id: string; technique: string; testIndex: number; exitCode: number | null;
  executeStatus: string; cleanupStatus: string; stdout: string; stderr: string;
  startedAt: string | null; endedAt: string | null;
}

function ConsentBanner({ fleetId, consent, allowedScope, onChange }: { fleetId: string; consent?: ConsentStatus | null; allowedScope: string[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const grant = async () => {
    setBusy(true);
    try {
      await fetch(`/api/fleets/${fleetId}/consent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ttlDays: 30 }) });
      onChange();
    } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!confirm("Revoke consent? The fleet won't be authorized to run until re-granted.")) return;
    setBusy(true);
    try { await fetch(`/api/fleets/${fleetId}/consent`, { method: "DELETE" }); onChange(); } finally { setBusy(false); }
  };

  const ok = consent?.state === "valid";
  const tone = ok ? "border-success/30 bg-success/10 text-success"
    : consent ? "border-danger/30 bg-danger/10 text-danger"
    : "border-warning/30 bg-warning/10 text-warning";
  const Icon = ok ? ShieldCheck : ShieldAlert;

  return (
    <div className={cn("rounded-xl border px-4 py-2.5 flex items-center gap-3 text-xs", tone)}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        {ok ? (
          <>Authorized to run · consent valid until {consent!.validTo ? new Date(consent!.validTo).toLocaleDateString() : "—"} · by {consent!.authorizedBy}
            {consent!.scopes.length > 0 && <span className="font-mono"> · scopes: {consent!.scopes.join(", ")}</span>}</>
        ) : consent ? (
          <>Consent {consent.state} — runs are blocked until re-authorized.</>
        ) : (
          <>No consent attached — runs proceed in dev but are blocked under enforcement. Grant authorization before running on real endpoints.</>
        )}
        {allowedScope.length > 0 && <span className="block text-[10px] opacity-80 mt-0.5">Fleet allowed scope: {allowedScope.join(", ")}</span>}
      </div>
      {ok
        ? <button onClick={revoke} disabled={busy} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-current/30 hover:bg-current/10">Revoke</button>
        : <button onClick={grant} disabled={busy} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded bg-accent text-white hover:bg-[#60a5fa]">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Grant consent (30d)</button>}
    </div>
  );
}

// Privilege / integrity badge from the agent's reported host facts.
function PrivilegeBadge({ host }: { host: Record<string, any> | undefined }) {
  if (!host || (host.elevated === undefined && !host.integrity)) {
    return <span className="text-[10px] rounded px-1.5 py-0.5 border border-border text-muted-foreground" title="Agent hasn't reported privilege (update the agent to v0.2.2+)">priv: unknown</span>;
  }
  const integrity = String(host.integrity || (host.elevated ? "high" : "user")).toLowerCase();
  const elevated = host.elevated === true || integrity === "system" || integrity === "high" || integrity === "root";
  const label =
    integrity === "system" ? "SYSTEM" :
    integrity === "root" ? "ROOT" :
    integrity === "high" ? "HIGH (admin)" :
    integrity === "medium" ? "MEDIUM" : "LOW (user)";
  return (
    <span
      title={`Agent runs with ${elevated ? "elevated" : "limited"} privilege${host.user ? ` as ${host.user}` : ""}. High/SYSTEM can run privileged techniques (e.g. LSASS dump); low can't.`}
      className={cn(
        "text-[10px] font-bold rounded px-1.5 py-0.5 border inline-flex items-center gap-1",
        elevated ? "border-danger/40 bg-danger/10 text-danger" : "border-success/40 bg-success/10 text-success",
      )}
    >
      {elevated ? <ShieldAlert className="h-2.5 w-2.5" /> : <ShieldCheck className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function NodeRowItem({ fleetId, node: n, onRevoke, onRefresh }: { fleetId: string; node: NodeRow; onRevoke: () => void; onRefresh: () => void }) {
  const lv = LIVENESS[n.liveness];
  const [open, setOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const paused = n.liveness === "paused";

  // Pause = hold jobs (agent stays enrolled + heartbeating); Resume = allow jobs.
  const toggleHold = async () => {
    setHolding(true);
    try {
      await fetch(`/api/fleets/${fleetId}/nodes/${n.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: paused ? "resume" : "pause" }),
      });
      onRefresh();
    } finally { setHolding(false); }
  };
  const [mode, setMode] = useState<"smoke" | "atomic">("smoke");
  const [technique, setTechnique] = useState("T1059.001");
  const [testIndex, setTestIndex] = useState(1);
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [pending, setPending] = useState<Array<{ id: string; status: string }>>([]);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = async () => {
    const r = await fetch(`/api/fleets/${fleetId}/nodes/${n.id}/test-runs`);
    if (r.ok) { const d = await r.json(); setRuns(d.runs || []); setPending(d.pending || []); }
  };
  useEffect(() => {
    if (!open) { if (poll.current) clearInterval(poll.current); return; }
    loadRuns();
    poll.current = setInterval(loadRuns, 3000);
    return () => { if (poll.current) clearInterval(poll.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fleetId, n.id]);

  const dispatch = async () => {
    setDispatching(true); setError(null);
    try {
      const body = mode === "smoke" ? { useSmoke: true } : { technique, testIndex };
      const r = await fetch(`/api/fleets/${fleetId}/nodes/${n.id}/run-test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "dispatch failed"); return; }
      await loadRuns();
    } finally { setDispatching(false); }
  };

  const RUN_ICON: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
    success: { Icon: CheckCircle2, color: "text-success" },
    failed:  { Icon: XCircle, color: "text-danger" },
    blocked: { Icon: AlertTriangle, color: "text-warning" },
  };

  return (
    <div>
      <div className="px-4 py-2.5 flex items-center gap-3">
        <span className={cn("w-2 h-2 rounded-full flex-shrink-0", lv.dot, n.liveness === "online" && "animate-pulse")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{n.hostname || n.name || n.id.slice(0, 8)}</span>
            <span className={cn("text-[10px] uppercase font-bold", lv.color)}>{lv.label}</span>
            <span className="text-[10px] text-muted-foreground font-mono">{n.os} {n.arch}</span>
            {n.agentVersion && <span className="text-[10px] text-muted-foreground font-mono">v{n.agentVersion}</span>}
            <PrivilegeBadge host={n.hostStatus} />
            {pending.length > 0 && <span className="text-[10px] text-info inline-flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" /> {pending.length} running</span>}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            last seen: {n.lastSeen ? new Date(n.lastSeen).toLocaleTimeString() : "never"}
            {n.hostStatus?.user && <> · running as <span className="font-mono text-foreground">{String(n.hostStatus.user)}</span></>}
            {n.hostStatus?.cpu != null && <> · cpu {Number(n.hostStatus.cpu).toFixed(0)}%</>}
          </div>
        </div>
        {n.status !== "revoked" && (
          <>
            <button onClick={() => setOpen((v) => !v)} title="Access this endpoint — view details and run tests"
              className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover">
              {open ? <ChevronDown className="h-3 w-3" /> : <Terminal className="h-3 w-3" />} Access
            </button>
            <button onClick={toggleHold} disabled={holding}
              title={paused ? "Resume — let this endpoint receive jobs again" : "Pause — hold jobs; the agent stays enrolled and online"}
              className={cn("inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border hover:bg-card-hover disabled:opacity-50",
                paused ? "text-success" : "text-foreground")}>
              {holding ? <Loader2 className="h-3 w-3 animate-spin" /> : paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button onClick={onRevoke} title="Revoke — stop the agent entirely; re-enrollment required to use it again"
              className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded text-danger hover:bg-danger/10">
              <Trash2 className="h-3 w-3" /> Revoke
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="px-4 pb-3 bg-background/30 border-t border-border space-y-2">
          {paused && (
            <div className="mt-2 rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info inline-flex items-start gap-1.5">
              <Pause className="h-3 w-3 mt-0.5 shrink-0" />
              This endpoint is <span className="font-semibold">paused</span> — dispatched tests will queue but not run until you Resume it.
            </div>
          )}
          {/* Dispatcher */}
          <div className="flex items-center gap-2 flex-wrap pt-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {([["smoke", "Safe connectivity test"], ["atomic", "Atomic test"]] as const).map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)} className={cn(
                  "px-2.5 py-1 text-[11px] font-medium",
                  mode === m ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
                )}>{label}</button>
              ))}
            </div>
            {mode === "atomic" && (
              <>
                <input value={technique} onChange={(e) => setTechnique(e.target.value)} placeholder="T1059.001"
                  className="w-28 px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                <input type="number" value={testIndex} onChange={(e) => setTestIndex(parseInt(e.target.value, 10) || 1)} min={1}
                  className="w-14 px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              </>
            )}
            <button onClick={dispatch} disabled={dispatching || n.liveness === "offline"} className="inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
              {dispatching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Dispatch
            </button>
            {mode === "atomic" && (
              <span className="text-[10px] text-warning inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> runs a real ART command on this endpoint
              </span>
            )}
          </div>
          {error && <div className="text-[11px] text-danger inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {error}</div>}

          {/* Results */}
          {runs.length === 0 ? (
            <div className="text-[11px] text-muted-foreground py-2">No test runs yet. Dispatch one above; results appear within a few seconds.</div>
          ) : (
            <div className="space-y-1">
              {runs.map((r) => {
                const ri = RUN_ICON[r.executeStatus] || RUN_ICON.failed;
                return (
                  <details key={r.id} className="rounded border border-border bg-card">
                    <summary className="px-2 py-1.5 cursor-pointer flex items-center gap-2 text-[11px]">
                      <ri.Icon className={cn("h-3 w-3", ri.color)} />
                      <span className="font-mono text-accent">{r.technique} #{r.testIndex}</span>
                      <span className={cn("uppercase font-bold text-[9px]", ri.color)}>{r.executeStatus}</span>
                      <span className="text-[10px] text-muted-foreground">cleanup: <span className={cn(r.cleanupStatus === "ok" ? "text-success" : "text-danger")}>{r.cleanupStatus}</span></span>
                      <span className="text-[10px] text-muted-foreground font-mono">exit={r.exitCode ?? "?"}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{r.endedAt ? new Date(r.endedAt).toLocaleTimeString() : ""}</span>
                    </summary>
                    {(r.stdout || r.stderr) && (
                      <div className="border-t border-border px-2 py-1.5 space-y-1">
                        {r.stdout && <pre className="text-[10px] font-mono text-foreground whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{r.stdout}</pre>}
                        {r.stderr && <pre className="text-[10px] font-mono text-danger/80 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">{r.stderr}</pre>}
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EnrollNodeStepper({ fleetId, onClose }: { fleetId: string; onClose: () => void }) {
  const [os, setOs] = useState<"linux" | "windows" | "macos">("linux");
  const [arch, setArch] = useState<"x86_64" | "aarch64">("x86_64");
  const [delivery, setDelivery] = useState<"download" | "source">("download");
  const [mode, setMode] = useState<"foreground" | "service">("service");
  const [token, setToken] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [cpUrl, setCpUrl] = useState("");          // control-plane URL the endpoint will call back to
  const [manifest, setManifest] = useState<{ available: boolean; sha256: string; sizeBytes: number; download_url: string } | null>(null);

  useEffect(() => { setOrigin(window.location.origin); setCpUrl(window.location.origin); }, []);

  // Probe what's published for this OS/arch so we can offer download vs build.
  useEffect(() => {
    let cancelled = false;
    setManifest(null);
    fetch(`/api/v1/agent/manifest?os=${os}&arch=${arch}`)
      .then((r) => r.json())
      .then((m) => { if (!cancelled) { setManifest(m); if (!m.available) setDelivery("source"); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [os, arch]);

  const mint = async () => {
    setMinting(true);
    try {
      const r = await fetch(`/api/fleets/${fleetId}/tokens`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `${os}-enroll`, ttlHours: 24 }),
      });
      const d = await r.json();
      if (r.ok) setToken(d.token);
    } finally { setMinting(false); }
  };

  const cp = (cpUrl || origin).replace(/\/$/, "");
  const downloadUrl = `${cp}/api/v1/agent/download?os=${os}&arch=${arch}`;
  const win = os === "windows";

  // The install command. Two delivery paths:
  //   download — pull the published binary from the control plane (no source),
  //              verify its sha256, then enroll + install/run.
  //   source   — build from a local checkout with cargo, then enroll.
  const cmd = (() => {
    if (!token) return "";
    const lines: string[] = [];
    let exe: string;

    if (delivery === "download") {
      exe = win ? ".\\bas_agent.exe" : "./bas_agent";
      const sha = manifest?.sha256 || "";
      if (win) {
        lines.push("# download the agent from the control plane (run in an elevated PowerShell):");
        lines.push(`iwr "${downloadUrl}" -OutFile bas_agent.exe`);
        if (sha) {
          lines.push(`if ((Get-FileHash bas_agent.exe -Algorithm SHA256).Hash -ne "${sha.toUpperCase()}") { throw "sha256 mismatch" }`);
        }
      } else {
        lines.push("# download the agent from the control plane:");
        lines.push(`curl -fsSL "${downloadUrl}" -o bas_agent && chmod +x bas_agent`);
        if (sha) lines.push(`echo "${sha}  bas_agent" | sha256sum -c -`);
      }
      lines.push("");
    } else {
      exe = win ? ".\\bas-agent\\target\\release\\bas_agent.exe" : "./bas-agent/target/release/bas_agent";
      lines.push("# build from a source checkout:");
      lines.push("cargo build --release -p bas-agent");
      lines.push("");
    }

    // One-time host prep: install the simulation tooling (Atomic Red Team
    // module + atomics, PurpleSharp) LOCALLY on the endpoint so fleet
    // simulations run fast with no per-run download (which otherwise times out).
    // The fleet runs independently of the Local Lab, so each endpoint carries
    // its own tooling.
    lines.push("# ONE-TIME: install simulation tooling on this endpoint (Atomic Red Team + PurpleSharp):");
    if (win) {
      lines.push(`iwr "${cp}/api/v1/agent/prepare?os=windows" -UseBasicParsing | iex`);
    } else {
      lines.push(`curl -fsSL "${cp}/api/v1/agent/prepare?os=${os}"   # review, then run the printed steps`);
    }
    lines.push("");

    lines.push("# enroll this endpoint (token shown once):");
    lines.push(`${exe} enroll --token ${token} --url ${cp}`);
    lines.push("");
    if (mode === "service") {
      lines.push("# install as an OS service (auto-start on boot, restart on crash):");
      lines.push(win ? `${exe} service install   # elevated PowerShell` : `sudo ${exe} service install`);
    } else {
      lines.push("# run in the foreground (Ctrl-C to stop):");
      lines.push(`${exe} run`);
    }
    return lines.join("\n");
  })();

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Enroll a node</h3>
        <button onClick={onClose} className="ml-auto p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Target OS:</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["linux", "windows", "macos"] as const).map((o) => (
              <button key={o} onClick={() => setOs(o)} className={cn(
                "px-3 py-1 text-[11px] font-medium",
                os === o ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
              )}>{o}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Arch:</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {(["x86_64", "aarch64"] as const).map((a) => (
              <button key={a} onClick={() => setArch(a)} className={cn(
                "px-2.5 py-1 text-[11px] font-mono font-medium",
                arch === a ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
              )}>{a}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Run mode:</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {([["service", "Service (survives reboot)"], ["foreground", "Foreground (quick test)"]] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} className={cn(
                "px-3 py-1 text-[11px] font-medium",
                mode === m ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
              )}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Delivery: download a hosted binary vs build from source */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Delivery:</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button onClick={() => manifest?.available && setDelivery("download")} disabled={!manifest?.available}
            className={cn("px-3 py-1 text-[11px] font-medium inline-flex items-center gap-1",
              delivery === "download" ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
              !manifest?.available && "opacity-40 cursor-not-allowed")}>
            <Download className="h-3 w-3" /> Download from server
          </button>
          <button onClick={() => setDelivery("source")} className={cn("px-3 py-1 text-[11px] font-medium",
            delivery === "source" ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground")}>
            Build from source
          </button>
        </div>
        {manifest && (manifest.available
          ? <a href={downloadUrl} className="text-[10px] text-accent hover:underline inline-flex items-center gap-1">
              <Download className="h-3 w-3" /> direct download ({(manifest.sizeBytes / 1e6).toFixed(1)} MB)
              <span className="text-muted-foreground font-mono">sha256 {manifest.sha256.slice(0, 12)}…</span>
            </a>
          : <span className="text-[10px] text-warning inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> no published binary for {os}/{arch} — build from source, or run scripts/publish-bas-agent.sh
            </span>)}
      </div>

      {/* Control-plane URL the endpoint calls back to — must be reachable FROM the
          target (e.g. the host's LAN IP for a bridged VM), not localhost. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">Control plane URL:</span>
        <input
          value={cpUrl} onChange={(e) => setCpUrl(e.target.value)}
          placeholder="http://192.168.1.10:3000"
          className="flex-1 min-w-[220px] px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
        {/localhost|127\.0\.0\.1/.test(cp) && (
          <span className="text-[10px] text-warning inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> a remote endpoint (e.g. a bridged VM) can't reach localhost — use the host's LAN IP
          </span>
        )}
      </div>

      {!token ? (
        <button onClick={mint} disabled={minting} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
          {minting ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
          Generate enrollment token (24h)
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
            <Terminal className="h-3 w-3" /> Run on the target endpoint (token shown once — copy now)
          </div>
          <div className="relative">
            <pre className="text-[11px] font-mono text-foreground bg-background/80 border border-border rounded p-3 overflow-x-auto whitespace-pre">{cmd}</pre>
            <button
              onClick={() => { navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="absolute right-2 top-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-1 rounded border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />} {copied ? "copied" : "copy"}
            </button>
          </div>
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Waiting for first heartbeat — the node appears in the list above the moment it beacons.
          </div>
        </div>
      )}
    </div>
  );
}
