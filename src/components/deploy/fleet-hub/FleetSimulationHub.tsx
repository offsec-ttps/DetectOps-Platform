"use client";

/**
 * Fleet Simulation hub (Deploy → Remote Fleet).
 *
 * Adversary-emulation via C2: endpoints run a lightweight beacon, the C2 server
 * pushes TTPs over the channel — no per-endpoint tooling install. Shows:
 *   1. C2 options catalog (Caldera live; Sliver/OpenBAS "coming soon")
 *   2. Your C2 servers — status, beacons, enrollment one-liner, run test, manage
 *   3. Native agent fleets — the existing FleetPage, kept as-is
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Cpu, Server, Plus, Loader2, RefreshCw, Wrench, Trash2, Copy, Check,
  ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, Radio, Play, Square, X, ExternalLink,
  Boxes,
} from "lucide-react";
import { cn } from "@/lib/utils";
import FleetPage from "@/app/(dashboard)/detections/enterprise/environments/fleet/page";
import DetectionLabDeploy from "./DetectionLabDeploy";
import C2Catalog from "./C2Catalog";
import C2TemplateDetail from "./C2TemplateDetail";
import type { C2CatalogEntry } from "@/config/c2-catalog";

type Category = "fleet" | "caldera" | "opensource";

interface Provider { kind: string; displayName: string; docsUrl: string; available: boolean; canDeploy: boolean }
interface C2Row {
  id: string; name: string; provider: string; mode: string; url: string; group: string;
  advertiseHost: string; agentPlatform: string; status: string; lastError: string;
  lastSeen: string | null; deploymentId: string | null; environmentTargetId: string | null;
  hasApiKey: boolean; createdAt: string;
}

const STATUS: Record<string, { label: string; dot: string; text: string }> = {
  online:     { label: "online",     dot: "bg-success", text: "text-success" },
  running:    { label: "running",    dot: "bg-success", text: "text-success" },
  installing: { label: "installing", dot: "bg-info animate-pulse", text: "text-info" },
  installed:  { label: "installed",  dot: "bg-warning", text: "text-warning" },
  starting:   { label: "starting",   dot: "bg-info animate-pulse", text: "text-info" },
  stopped:    { label: "stopped",    dot: "bg-muted", text: "text-muted-foreground" },
  offline:    { label: "offline",    dot: "bg-muted", text: "text-muted-foreground" },
  error:      { label: "error",      dot: "bg-danger", text: "text-danger" },
  unknown:    { label: "unknown",    dot: "bg-muted", text: "text-muted-foreground" },
};

export default function FleetSimulationHub() {
  const [catalog, setCatalog] = useState<C2CatalogEntry[]>([]);
  const [servers, setServers] = useState<C2Row[]>([]);
  const [localDeploy, setLocalDeploy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "connect" | "managed"; provider: Provider } | null>(null);
  const [activeCat, setActiveCat] = useState<Category>("caldera");
  const [detail, setDetail] = useState<C2CatalogEntry | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/c2");
      const d = await r.json();
      setCatalog(d.catalog || []);
      setServers(d.items || []);
      setLocalDeploy(!!d.localDeployAvailable);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  // Open the deploy/connect form for a catalog entry (Provider-shaped adapter).
  const openForEntry = (entry: C2CatalogEntry, mode: "connect" | "managed") => {
    setDetail(null);
    setModal({
      mode,
      provider: {
        kind: entry.id, displayName: entry.name, docsUrl: entry.docsUrl,
        available: entry.deploy.available,
        canDeploy: entry.deploy.method === "provider" || entry.deploy.method === "docker",
      },
    });
  };
  useEffect(() => { load(); }, [load]);
  // Poll while anything is mid-transition so status flips without a manual refresh.
  useEffect(() => {
    if (!servers.some((s) => ["installing", "starting", "deploying"].includes(s.status))) return;
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [servers, load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Cpu className="h-6 w-6 text-accent" /> Fleet Simulation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
          Test endpoint defenses with a real C2. Endpoints run a lightweight beacon; your C2 server pushes
          MITRE ATT&amp;CK techniques over the channel — <span className="text-foreground">no per-endpoint tooling install,
          no AV exclusions, no endpoint internet</span>. Pick a C2 framework, stand up (or connect) a standalone server,
          enroll beacons, and score detection.
        </p>
      </div>

      {/* Category selector — the three ways to run a simulation */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: "fleet", label: "Fleet — Native Agent", desc: "Our lightweight Rust agent", icon: Cpu },
          { key: "caldera", label: "Caldera", desc: "MITRE adversary emulation + GUI", icon: Radio },
          { key: "opensource", label: "Open-Source C2", desc: "Curated deployable frameworks", icon: Boxes },
        ] as const).map((t) => {
          const Icon = t.icon; const active = activeCat === t.key;
          return (
            <button key={t.key} onClick={() => setActiveCat(t.key)}
              className={cn("flex-1 min-w-[200px] text-left rounded-xl border p-3 transition-colors", active ? "border-accent bg-accent/5" : "border-border bg-card hover:bg-card-hover")}>
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4", active ? "text-accent" : "text-muted-foreground")} />
                <span className={cn("text-sm font-semibold", active ? "text-accent" : "text-foreground")}>{t.label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Category 1 — Fleet native agent */}
      {activeCat === "fleet" && (
        <section className="space-y-2">
          <p className="text-xs text-muted-foreground">DetectOps signed-agent endpoints (job-poll). Enroll native agents and run campaigns without a third-party C2.</p>
          <div className="rounded-xl border border-border bg-card/40 p-1 [&>div]:!p-4 [&>div]:!max-w-none">
            <FleetPage />
          </div>
        </section>
      )}

      {/* Category 2 — Caldera (fully wired provider) */}
      {activeCat === "caldera" && (() => {
        const cal = catalog.find((e) => e.category === "caldera");
        return (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">MITRE Caldera</p>
                <p className="text-xs text-muted-foreground mt-0.5">Connect a Caldera you already run, or deploy a standalone server on this host. Fully wired: enroll beacons and run techniques from the Campaign Designer.</p>
              </div>
              <button onClick={load} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground shrink-0"><RefreshCw className="h-3 w-3" /> Refresh</button>
            </div>
            {cal && (
              <div className="rounded-xl border border-border bg-card p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent shrink-0"><Radio className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">{cal.name} <span className="text-[10px] font-normal text-muted-foreground">{cal.language}</span></h3>
                  <p className="text-[11px] text-muted-foreground">{cal.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setDetail(cal)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover">Details</button>
                  <button onClick={() => openForEntry(cal, "connect")} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover"><Plus className="h-3 w-3" /> Connect</button>
                  <button onClick={() => openForEntry(cal, "managed")} disabled={!localDeploy}
                    title={!localDeploy ? "Managed deploy is available on self-hosted installs (PLATFORM_MODE=self-hosted)" : "Deploy a standalone Caldera on this host"}
                    className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"><Server className="h-3 w-3" /> Deploy</button>
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* Category 3 — Open-source + commercial catalog */}
      {activeCat === "opensource" && (
        <section className="space-y-3">
          <div className="flex items-center justify-end">
            <button onClick={load} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"><RefreshCw className="h-3 w-3" /> Refresh</button>
          </div>
          {loading ? (
            <div className="py-6 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…</div>
          ) : (
            <C2Catalog entries={catalog.filter((e) => e.category !== "caldera")} onSelect={setDetail} />
          )}
        </section>
      )}

      {/* 2. Your C2 servers (local/managed + connected) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">C2 Framework (Local)</p>
            <p className="text-xs text-muted-foreground mt-0.5">Servers you&apos;ve deployed or connected — start, stop, run a test, or manage each one.</p>
          </div>
          <button onClick={load} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground shrink-0"><RefreshCw className="h-3 w-3" /> Refresh</button>
        </div>
        {loading ? (
          <div className="py-6 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : servers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center text-xs text-muted-foreground">
            No C2 servers yet. Deploy or Connect one above.
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map((s) => <C2ServerRow key={s.id} server={s} onChanged={load} />)}
          </div>
        )}
      </section>

      {/* 3. Virtual Labs / VMs — Detection lab (Splunk + Windows) for real-time detection scoring */}
      <DetectionLabDeploy />

      {detail && (
        <C2TemplateDetail
          entry={detail}
          localDeploy={localDeploy}
          onClose={() => setDetail(null)}
          onDeploy={(e) => openForEntry(e, "managed")}
          onConnect={(e) => openForEntry(e, "connect")}
        />
      )}
      {modal && <ServerModal mode={modal.mode} provider={modal.provider} onClose={() => setModal(null)} onCreated={() => { setModal(null); load(); }} />}
    </div>
  );
}

// ─── One C2 server row (expandable manage panel) ────────────────────────────
function C2ServerRow({ server: s, onChanged }: { server: C2Row; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; agents?: number; version?: string; error?: string } | null>(null);
  const [beacons, setBeacons] = useState<any[] | null>(null);
  const [enrollOs, setEnrollOs] = useState<"windows" | "linux" | "darwin">("windows");
  const [enrollCmd, setEnrollCmd] = useState("");
  const [copied, setCopied] = useState(false);
  const [tech, setTech] = useState("T1059.001");
  const [runResult, setRunResult] = useState<any | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const st = STATUS[s.status] || STATUS.unknown;

  const checkHealth = async () => {
    setBusy("health");
    try { const r = await fetch(`/api/c2/${s.id}/health`, { method: "POST" }); setHealth(await r.json()); onChanged(); }
    finally { setBusy(null); }
  };
  const loadBeacons = async () => {
    setBusy("beacons");
    try { const r = await fetch(`/api/c2/${s.id}/agents`); const d = await r.json(); setBeacons(d.beacons || []); }
    finally { setBusy(null); }
  };
  const loadEnroll = async (os: typeof enrollOs) => {
    setEnrollOs(os);
    const r = await fetch(`/api/c2/${s.id}/enroll?os=${os}`); const d = await r.json(); setEnrollCmd(d.command || "");
  };
  const runTech = async () => {
    if (!tech.trim()) return;
    setBusy("run"); setRunResult(null);
    try {
      const r = await fetch(`/api/c2/${s.id}/run-technique`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ techniqueId: tech.trim() }) });
      const d = await r.json(); setRunResult(d.result || d);
    } finally { setBusy(null); }
  };
  const del = async () => {
    setBusy("del");
    try { await fetch(`/api/c2/${s.id}`, { method: "DELETE" }); onChanged(); }
    finally { setBusy(null); }
  };
  const [netStart, setNetStart] = useState(false);
  const lifecycle = async (action: "start" | "stop", advertiseHost?: string) => {
    setBusy(action);
    try { await fetch(`/api/c2/${s.id}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, advertiseHost }) }); setNetStart(false); onChanged(); }
    finally { setBusy(null); }
  };
  // Reach the console on whatever host the operator is browsing DetectOps from
  // (Caldera binds 0.0.0.0), falling back to the stored advertised URL.
  const consoleHref = () => {
    try { const u = new URL(s.url); return typeof window !== "undefined" ? `${u.protocol}//${window.location.hostname}:${u.port || "8888"}` : s.url; }
    catch { return s.url; }
  };
  const managed = s.mode === "managed";
  const canStart = managed && ["installed", "stopped", "error"].includes(s.status) && !!s.deploymentId;
  const isRunning = s.status === "running" || s.status === "online";
  const transitioning = ["installing", "starting"].includes(s.status);
  const copy = () => { navigator.clipboard?.writeText(enrollCmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };

  useEffect(() => { if (open && !enrollCmd) loadEnroll("windows"); /* eslint-disable-next-line */ }, [open]);

  return (
    <div className={cn("rounded-xl border bg-card", open ? "border-accent/40" : "border-border")}>
      <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <span className={cn("w-2 h-2 rounded-full flex-shrink-0", st.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{s.name}</span>
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-muted/15 text-muted-foreground">{s.provider}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{s.mode === "managed" ? "deployed" : "connected"}</span>
            <span className={cn("text-[10px] uppercase font-bold", st.text)}>{st.label}</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">{s.url || "(pending deploy)"} · group {s.group}</div>
          {s.status === "error" && s.lastError && <div className="text-[10px] text-danger mt-0.5">{s.lastError}</div>}
        </div>
        {transitioning && <span className="inline-flex items-center gap-1 text-[11px] text-info"><Loader2 className="h-3 w-3 animate-spin" /> {s.status}…</span>}
        {canStart && (
          <button onClick={() => setNetStart(true)} disabled={busy === "start"} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded bg-success/90 text-white hover:bg-success disabled:opacity-50">
            {busy === "start" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start…
          </button>
        )}
        {isRunning && managed && (
          <button onClick={() => lifecycle("stop")} disabled={busy === "stop"} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">
            {busy === "stop" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} Stop
          </button>
        )}
        {isRunning && s.url && (
          <a href={consoleHref()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-accent/40 text-accent hover:bg-accent/10"><ExternalLink className="h-3 w-3" /> Open C2</a>
        )}
        {managed && (
          <Link href="/caldera" title="Full console + start/stop + embedded UI" className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-accent/40 text-accent hover:bg-accent/10"><Radio className="h-3 w-3" /> Console</Link>
        )}
        <Link href={`/manage-labs?tab=fleet&c2=${s.id}`} title="Manage / delete under Manage Labs"
          className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover"><Wrench className="h-3 w-3" /> Manage</Link>
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Details
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 border-t border-border space-y-4 pt-3">
          {/* Health + beacons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={checkHealth} disabled={busy === "health"} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">
              {busy === "health" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Check health
            </button>
            <button onClick={loadBeacons} disabled={busy === "beacons"} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">
              {busy === "beacons" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />} List beacons
            </button>
            {health && (
              <span className={cn("text-[11px]", health.ok ? "text-success" : "text-danger")}>
                {health.ok ? `✓ reachable · ${health.agents ?? 0} beacon(s)${health.version ? ` · v${health.version}` : ""}` : `✗ ${health.error}`}
              </span>
            )}
          </div>

          {beacons && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-1.5 border-b border-border text-[11px] font-semibold text-foreground">Beacons ({beacons.length})</div>
              {beacons.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-muted-foreground">No beacons checked in yet. Enroll one with the command below.</div>
              ) : (
                <div className="divide-y divide-border">
                  {beacons.map((b, i) => (
                    <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[11px]">
                      <Radio className="h-3 w-3 text-success" />
                      <span className="font-mono text-foreground">{b.host || b.id}</span>
                      <span className="text-muted-foreground">{b.platform}</span>
                      {b.username && <span className="text-muted-foreground">· {b.username}</span>}
                      {b.privilege && <span className="ml-auto text-[10px] uppercase text-muted-foreground">{b.privilege}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Enrollment one-liner */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-foreground">Enroll a beacon</span>
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {(["windows", "linux", "darwin"] as const).map((os) => (
                  <button key={os} onClick={() => loadEnroll(os)} className={cn("px-2 py-0.5 text-[10px] font-medium", enrollOs === os ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground")}>{os}</button>
                ))}
              </div>
              <button onClick={copy} className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                {copied ? <><Check className="h-3 w-3 text-success" /> copied</> : <><Copy className="h-3 w-3" /> copy</>}
              </button>
            </div>
            <pre className="text-[10px] font-mono bg-background/60 border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">{enrollCmd || "…"}</pre>
            <p className="text-[10px] text-muted-foreground">Run once on the endpoint. The beacon is pulled from the C2 over the LAN — no internet or pre-installed tooling required.</p>
          </div>

          {/* Run a technique */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-foreground">Run a test technique</span>
            <div className="flex items-center gap-2">
              <input value={tech} onChange={(e) => setTech(e.target.value)} placeholder="T1059.001"
                className="w-40 px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              <button onClick={runTech} disabled={busy === "run"} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
                {busy === "run" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
              </button>
              <span className="text-[10px] text-muted-foreground">executes on beacons in group “{s.group}”</span>
            </div>
            {runResult && (
              <div className={cn("rounded-md border p-2 text-[11px]", runResult.status === "ok" ? "border-success/30 bg-success/10" : runResult.status === "failure" ? "border-danger/30 bg-danger/10" : "border-warning/30 bg-warning/10")}>
                <div className="font-medium text-foreground">{runResult.status} · {runResult.notes}</div>
                {runResult.stdout && <pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-all text-muted-foreground max-h-40 overflow-y-auto">{runResult.stdout}</pre>}
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="pt-1 border-t border-border flex justify-end">
            {confirmDel ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-danger">{s.mode === "managed" ? "Tear down the container and remove?" : "Forget this server?"}</span>
                <button onClick={del} disabled={busy === "del"} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded bg-danger text-white hover:bg-danger/90 disabled:opacity-50">{busy === "del" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Confirm</button>
                <button onClick={() => setConfirmDel(false)} className="text-[11px] h-7 px-2 rounded border border-border text-muted-foreground">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded text-danger hover:bg-danger/10"><Trash2 className="h-3 w-3" /> Delete</button>
            )}
          </div>
        </div>
      )}

      {netStart && <NetStartModal onClose={() => setNetStart(false)} onStart={(host) => lifecycle("start", host)} busy={busy === "start"} />}
    </div>
  );
}

// ─── Network chooser for Start ──────────────────────────────────────────────
function NetStartModal({ onClose, onStart, busy }: { onClose: () => void; onStart: (host: string) => void; busy: boolean }) {
  const [ifaces, setIfaces] = useState<Array<{ name: string; address: string; internal: boolean; hint: string }> | null>(null);
  const [host, setHost] = useState("");
  useEffect(() => {
    fetch("/api/c2/interfaces").then((r) => r.json()).then((d) => {
      setIfaces(d.interfaces || []);
      setHost((d.interfaces || []).find((i: any) => !i.internal)?.address || "");
    }).catch(() => setIfaces([]));
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Choose the network to start on</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-[11px] text-muted-foreground">This is the address baked into the beacon enrollment command + console URL. Pick the network your target endpoints are on (Caldera itself listens on all interfaces).</p>
        {ifaces === null ? (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> detecting interfaces…</div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {ifaces.map((i) => (
              <label key={i.name + i.address} className={cn("flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border cursor-pointer", host === i.address ? "border-accent bg-accent/10" : "border-border hover:bg-card-hover")}>
                <input type="radio" name="netstart" checked={host === i.address} onChange={() => setHost(i.address)} />
                <span className="font-mono text-foreground">{i.address}</span>
                <span className="text-muted-foreground">{i.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{i.hint}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground">Cancel</button>
          <button onClick={() => onStart(host)} disabled={busy || !host} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-success/90 text-white hover:bg-success disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start on {host || "…"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Connect / Deploy modal ─────────────────────────────────────────────────
function ServerModal({ mode, provider, onClose, onCreated }: { mode: "connect" | "managed"; provider: Provider; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [group, setGroup] = useState("red");
  const [advertiseHost, setAdvertiseHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const body: any = { name: name.trim(), provider: provider.kind, mode, group: group.trim() || "red" };
      if (mode === "connect") { body.url = url.trim(); body.apiKey = apiKey.trim(); }
      else { body.advertiseHost = advertiseHost.trim(); }
      const r = await fetch("/api/c2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "failed"); return; }
      if (mode === "connect" && d.health && !d.health.ok) setError(`Saved, but health check failed: ${d.health.error}`);
      onCreated();
    } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{mode === "connect" ? "Connect" : "Deploy"} {provider.displayName}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <label className="block text-[11px] text-muted-foreground">Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-caldera-prod" className="mt-1 w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </label>

        {mode === "connect" ? (
          <>
            <label className="block text-[11px] text-muted-foreground">Caldera URL
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://10.0.0.20:8888" className="mt-1 w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </label>
            <label className="block text-[11px] text-muted-foreground">API key (red)
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="from Caldera conf/local.yml → api_key_red" className="mt-1 w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </label>
          </>
        ) : (
          <>
            <label className="block text-[11px] text-muted-foreground">Advertise host (LAN IP beacons reach)
              <input value={advertiseHost} onChange={(e) => setAdvertiseHost(e.target.value)} placeholder="auto-detect this host's LAN IP" className="mt-1 w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </label>
            <div className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Clones + builds {provider.displayName} on this host (first build takes a few minutes). Server-side internet is needed for the build; endpoints stay offline.
            </div>
          </>
        )}

        <label className="block text-[11px] text-muted-foreground">Group
          <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="red" className="mt-1 w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </label>

        {error && <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground">Cancel</button>
          <button onClick={submit} disabled={busy || !name.trim() || (mode === "connect" && (!url.trim() || !apiKey.trim()))}
            className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : mode === "connect" ? <Plus className="h-3.5 w-3.5" /> : <Server className="h-3.5 w-3.5" />}
            {mode === "connect" ? "Connect" : "Deploy"}
          </button>
        </div>
      </div>
    </div>
  );
}
