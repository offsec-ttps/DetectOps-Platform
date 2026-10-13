"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, RefreshCw, Play, Loader2, CheckCircle2, XCircle, ExternalLink,
  Radar, AlertTriangle, Link2, Link2Off, Sparkles, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Contribution {
  id: string;
  libraryKey: string | null;
  category: string | null;
  name: string;
  summary: string;
  attackTechniques: string;     // JSON
  tactic: string | null;
  platforms: string;            // JSON
  severity: string;
  sourceUrl: string | null;
  sourceVendor: string | null;
  sourceTitle: string | null;
  classifierMethod: string;
  classifierConfidence: number;
  classifierReason: string;
  atomicTestName: string | null;
  needsAtomic: boolean;
  status: string;
  createdAt: string;
}
interface Target { libraryKey: string; displayName: string; moduleId: string }
interface Counts { pending: number; unrouted: number; approved: number; rejected: number }
interface LastRun {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  reportsScanned: number; contributionsCreated: number; unrouted: number; errorMessage: string | null;
}

const FILTERS = [
  { key: "queue", label: "Review queue" },
  { key: "pending", label: "Pending" },
  { key: "unrouted", label: "Unrouted" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

const SEV: Record<string, string> = {
  critical: "bg-danger/15 text-danger border-danger/40",
  high: "bg-warning/15 text-warning border-warning/40",
  medium: "bg-info/15 text-info border-info/40",
  low: "bg-muted/15 text-muted-foreground border-border",
};

function parse(s: string): string[] { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }

export default function TiWatcherPage() {
  const [items, setItems] = useState<Contribution[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, unrouted: 0, approved: 0, rejected: 0 });
  const [targets, setTargets] = useState<Target[]>([]);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [filter, setFilter] = useState<string>("queue");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [routeChoice, setRouteChoice] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`/api/ti-watcher/contributions?status=${filter}`),
        fetch(`/api/ti-watcher/scan`),
      ]);
      const c = await cRes.json();
      const s = await sRes.json();
      setItems(c.items || []);
      setCounts(c.counts || counts);
      setTargets(c.targets || []);
      setLastRun(s.lastRun || null);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, [filter]); // eslint-disable-line

  useEffect(() => { setLoading(true); fetchData(); }, [filter]); // eslint-disable-line
  useEffect(() => {
    if (!auto) return;
    // Page-driven scan every 60 s while this review page stays open. The
    // always-on trigger is the post-TI-sync hook; deployed instances can also
    // run the optional GitHub Action cron hitting POST /api/ti-watcher/scan.
    const id = setInterval(() => { fetch("/api/ti-watcher/scan", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }).then(fetchData).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [auto, fetchData]);

  const runScan = async () => {
    setScanning(true);
    try {
      await fetch("/api/ti-watcher/scan", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      await fetchData();
    } finally { setScanning(false); }
  };

  const review = async (id: string, action: "approve" | "reject", libraryKey?: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/ti-watcher/contributions/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(libraryKey ? { libraryKey } : {}) }),
      });
      await fetchData();
    } finally { setBusyId(null); }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <Link href="/simulations" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Attack Simulations
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Radar className="h-5 w-5 text-purple" /> Library Updates</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            New techniques observed in the Threat Intelligence Platform, auto-routed into the matching simulation library. Review-gated — approve to add them to the library and Campaign Designer; reject to discard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-scan (60s)
          </label>
          <button onClick={runScan} disabled={scanning}
            className="inline-flex items-center gap-1.5 rounded-md bg-purple/15 text-purple border border-purple/40 px-3 py-1.5 text-sm font-medium hover:bg-purple/25 disabled:opacity-50">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run scan now
          </button>
        </div>
      </div>

      {/* last run */}
      <div className="rounded-lg border border-border bg-card/40 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-4 flex-wrap">
        <RefreshCw className="h-3.5 w-3.5" />
        {lastRun ? (
          <>
            <span>Last scan <b className={cn(lastRun.status === "failed" && "text-danger", lastRun.status === "completed" && "text-success")}>{lastRun.status}</b> {new Date(lastRun.startedAt).toLocaleString()}</span>
            <span>· {lastRun.reportsScanned} reports → {lastRun.contributionsCreated} new ({lastRun.unrouted} unrouted)</span>
            {lastRun.errorMessage && <span className="text-danger">· {lastRun.errorMessage}</span>}
          </>
        ) : <span>No scan has run yet — click “Run scan now”, or it runs automatically after each Threat-Intel sync.</span>}
      </div>

      {/* filter tabs + counts */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => {
          const n = f.key === "queue" ? counts.pending + counts.unrouted : (counts as any)[f.key];
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn("rounded-full px-3 py-1 text-xs border", filter === f.key ? "bg-foreground text-background border-foreground" : "bg-card/40 text-muted-foreground border-border hover:text-foreground")}>
              {f.label}{typeof n === "number" ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>

      {/* list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Nothing here. {filter === "queue" ? "No techniques are waiting for review." : `No ${filter} contributions.`}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((c) => {
            const atk = parse(c.attackTechniques);
            const plats = parse(c.platforms);
            const reviewable = c.status === "pending" || c.status === "unrouted";
            const chosen = routeChoice[c.id] || (c.libraryKey ?? "");
            return (
              <div key={c.id} className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{c.name}</span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] border", SEV[c.severity] || SEV.medium)}>{c.severity}</span>
                      {c.libraryKey ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] border border-purple/40 bg-purple/10 text-purple">{targets.find((t) => t.libraryKey === c.libraryKey)?.displayName || c.libraryKey}</span>
                      ) : (
                        <span className="rounded px-1.5 py-0.5 text-[10px] border border-warning/40 bg-warning/10 text-warning inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> unrouted</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{c.summary}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {atk.map((a) => <span key={a} className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono">{a}</span>)}
                    {plats.map((p) => <span key={p} className="rounded bg-info/10 text-info px-1.5 py-0.5 text-[10px]">{p}</span>)}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap text-xs">
                  {c.needsAtomic
                    ? <span className="inline-flex items-center gap-1 text-warning"><Link2Off className="h-3.5 w-3.5" /> needs atomic (reference-only until linked)</span>
                    : <span className="inline-flex items-center gap-1 text-success"><Link2 className="h-3.5 w-3.5" /> linked: {c.atomicTestName}</span>}
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    {c.classifierMethod === "ai" ? <Sparkles className="h-3.5 w-3.5" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
                    {c.classifierMethod} · {(c.classifierConfidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground italic">{c.classifierReason}</p>

                <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border pt-2.5">
                  {c.sourceUrl ? (
                    <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" /> {c.sourceVendor || "source"}: {c.sourceTitle || "report"}
                    </a>
                  ) : <span className="text-xs text-muted-foreground">{c.sourceVendor || "Threat Intel"}{c.sourceTitle ? ` · ${c.sourceTitle}` : ""}</span>}

                  {reviewable && (
                    <div className="flex items-center gap-2">
                      {!c.libraryKey && (
                        <select value={chosen} onChange={(e) => setRouteChoice((r) => ({ ...r, [c.id]: e.target.value }))}
                          className="rounded border border-border bg-background text-xs px-2 py-1">
                          <option value="">Route to…</option>
                          {targets.map((t) => <option key={t.libraryKey} value={t.libraryKey}>{t.displayName}</option>)}
                        </select>
                      )}
                      <button onClick={() => review(c.id, "reject")} disabled={busyId === c.id}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-danger/10 hover:text-danger disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                      <button onClick={() => review(c.id, "approve", c.libraryKey ? undefined : (chosen || undefined))}
                        disabled={busyId === c.id || (!c.libraryKey && !chosen)}
                        className="inline-flex items-center gap-1 rounded-md bg-success/15 text-success border border-success/40 px-2.5 py-1 text-xs font-medium hover:bg-success/25 disabled:opacity-50">
                        {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve
                      </button>
                    </div>
                  )}
                  {c.status === "approved" && <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> approved · in library</span>}
                  {c.status === "rejected" && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> rejected</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
