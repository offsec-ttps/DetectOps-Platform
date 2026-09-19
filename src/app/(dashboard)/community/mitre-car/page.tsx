"use client";

/**
 * MITRE CAR (Cyber Analytics Repository) browser
 *
 * Source: https://github.com/mitre-attack/car
 *
 * Each row is one analytic. Click → drawer with full description, ATT&CK
 * mapping, and tool-specific implementations (Splunk, EQL, pseudocode, etc).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Search, Filter, X, Loader2, ExternalLink, ScanSearch,
  CheckCircle2, AlertTriangle, ArrowLeft, Crosshair,
} from "lucide-react";
import Link from "next/link";

interface CarRuleListItem {
  id: string;
  upstreamRuleId: string;
  title: string;
  description: string;
  author: string;
  platforms: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  products: string[];
  ruleLanguage: string;
  sourceUrl: string;
  upstreamCreatedAt: string | null;
  changeStatus: string;
}

interface CarListResponse {
  enabled: boolean;
  registered?: boolean;
  items: CarRuleListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  message?: string;
}

interface CarRuleDetail extends CarRuleListItem {
  detectionLogicRaw: string;
  ruleType: string;
  references: string[];
  tags: string[];
  rawPayload: any;
}

const PLATFORM_OPTIONS = ["windows", "linux", "macos"];
const TACTIC_OPTIONS = [
  "TA0001", "TA0002", "TA0003", "TA0004", "TA0005", "TA0006",
  "TA0007", "TA0008", "TA0009", "TA0010", "TA0011", "TA0040",
];

export default function MitreCarPage() {
  const [data, setData] = useState<CarListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [technique, setTechnique] = useState("");
  const [tactic, setTactic] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CarRuleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (platform) p.set("platform", platform);
    if (technique) p.set("technique", technique);
    if (tactic) p.set("tactic", tactic);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [debouncedQ, platform, technique, tactic, page]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/community/mitre-car/rules?${queryString}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: CarListResponse = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { setPage(1); }, [debouncedQ, platform, technique, tactic]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/community/mitre-car/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.status === "failed") {
        setError(json.error || (json.errors && json.errors[0]?.message) || "Sync failed");
      }
      await fetchList();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/community/mitre-car/rules/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => { setSelectedId(null); setDetail(null); };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href="/community" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-accent mb-1">
            <ArrowLeft className="h-3 w-3" /> Community Content
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Crosshair className="h-6 w-6 text-accent" />
            MITRE CAR
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cyber Analytics Repository — analytic rationale, ATT&CK mapping, and tool-specific implementations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/mitre-attack/car"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Upstream
          </a>
          <button
            onClick={handleSync} disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
            {syncing ? "Syncing..." : "Sync from upstream"}
          </button>
        </div>
      </div>

      {/* Status banner */}
      {!loading && data && !data.registered && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-warning">Source not yet synced.</span>
            {" "}Click "Sync from upstream" to pull MITRE CAR analytics into the local catalog.
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 flex items-start gap-2">
          <X className="h-4 w-4 text-danger mt-0.5" />
          <div className="text-xs text-danger">{error}</div>
        </div>
      )}
      {data?.registered && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-xs text-foreground">
            <span className="font-medium text-success">{data.total}</span> analytics in catalog
            {data.totalPages > 0 && <span className="text-muted-foreground"> · page {data.page}/{data.totalPages}</span>}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search by ID, title, description..."
              className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted"
            />
          </div>
          <button
            onClick={() => { setQ(""); setPlatform(""); setTechnique(""); setTactic(""); }}
            className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1.5"
          >
            Clear
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[9px] text-muted-foreground">Platform</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground">
              <option value="">All</option>
              {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[9px] text-muted-foreground">Technique ID</span>
            <input
              type="text" value={technique} onChange={(e) => setTechnique(e.target.value)}
              placeholder="T1059.001"
              className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[10px] font-mono text-foreground"
            />
          </label>
          <label className="block">
            <span className="text-[9px] text-muted-foreground">Tactic</span>
            <select value={tactic} onChange={(e) => setTactic(e.target.value)} className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground">
              <option value="">All</option>
              {TACTIC_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        )}
        {data && data.items.length === 0 && !loading && (
          <div className="text-center py-12 text-xs text-muted-foreground">
            {data.registered ? "No analytics match your filters." : "Sync the source to populate the catalog."}
          </div>
        )}
        {data && data.items.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/50 text-[10px] text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">CAR ID</th>
                <th className="px-3 py-2 text-left font-medium">Title</th>
                <th className="px-3 py-2 text-left font-medium">Platforms</th>
                <th className="px-3 py-2 text-left font-medium">Tactics</th>
                <th className="px-3 py-2 text-left font-medium">Techniques</th>
                <th className="px-3 py-2 text-left font-medium">Implementations</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => openDetail(row.id)}
                  className="border-b border-border/30 hover:bg-card-hover/30 cursor-pointer"
                >
                  <td className="px-3 py-2.5">
                    <code className="text-[10px] font-mono text-accent">{row.upstreamRuleId}</code>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-xs font-medium text-foreground">{row.title}</div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{row.description}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-0.5">
                      {row.platforms.map((p) => (
                        <span key={p} className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">{p}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-0.5">
                      {row.mitreTactics.slice(0, 2).map((t) => (
                        <span key={t} className="text-[9px] font-mono text-warning bg-warning/10 rounded px-1">{t}</span>
                      ))}
                      {row.mitreTactics.length > 2 && (
                        <span className="text-[9px] text-muted">+{row.mitreTactics.length - 2}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-0.5">
                      {row.mitreTechniques.slice(0, 3).map((t) => (
                        <span key={t} className="text-[9px] font-mono text-accent bg-accent/10 rounded px-1">{t}</span>
                      ))}
                      {row.mitreTechniques.length > 3 && (
                        <span className="text-[9px] text-muted">+{row.mitreTechniques.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-0.5">
                      {row.products.slice(0, 3).map((p) => (
                        <span key={p} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/10 text-muted-foreground border border-border/50">
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-card-hover disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-[10px] text-muted-foreground">Page {page} / {data.totalPages}</span>
            <button
              onClick={() => setPage(Math.min(data.totalPages, page + 1))} disabled={page >= data.totalPages}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-card-hover disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closeDetail}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-[640px] h-full bg-card border-l border-border overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border px-5 py-3 flex items-center justify-between z-10">
              <div>
                <code className="text-[10px] font-mono text-accent">{detail?.upstreamRuleId}</code>
                <h3 className="text-sm font-semibold text-foreground">{detail?.title || "Loading..."}</h3>
              </div>
              <button onClick={closeDetail} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading && !detail && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
              </div>
            )}

            {detail && (
              <div className="px-5 py-4 space-y-4">
                {/* Description */}
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Description</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap">{detail.description}</p>
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-background/50 border border-border p-2">
                    <p className="text-[9px] text-muted-foreground uppercase">Author / contributors</p>
                    <p className="text-[11px] text-foreground">{detail.author || "—"}</p>
                  </div>
                  <div className="rounded-lg bg-background/50 border border-border p-2">
                    <p className="text-[9px] text-muted-foreground uppercase">Submitted</p>
                    <p className="text-[11px] text-foreground">
                      {detail.upstreamCreatedAt ? new Date(detail.upstreamCreatedAt).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>

                {/* ATT&CK */}
                {detail.mitreTechniques.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">ATT&CK Techniques</p>
                    <div className="flex flex-wrap gap-1">
                      {detail.mitreTechniques.map((t) => (
                        <a
                          key={t} target="_blank" rel="noopener noreferrer"
                          href={`https://attack.mitre.org/techniques/${t.replace(".", "/")}`}
                          className="text-[10px] font-mono text-accent bg-accent/10 hover:bg-accent/20 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                        >
                          {t} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Implementations from rawPayload */}
                {detail.rawPayload?.implementations && Array.isArray(detail.rawPayload.implementations) && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1.5">
                      Implementations ({detail.rawPayload.implementations.length})
                    </p>
                    <div className="space-y-2">
                      {detail.rawPayload.implementations.map((impl: any, i: number) => (
                        <div key={i} className="rounded-lg border border-border bg-background overflow-hidden">
                          <div className="px-3 py-1.5 border-b border-border bg-card-hover/50 flex items-center justify-between">
                            <span className="text-[10px] font-medium text-accent">{impl.type || "unknown"}</span>
                            {impl.data_model && (
                              <span className="text-[9px] text-muted-foreground">{impl.data_model}</span>
                            )}
                          </div>
                          {impl.description && (
                            <p className="text-[10px] text-muted-foreground px-3 py-1 italic">{impl.description}</p>
                          )}
                          <pre className="text-[10px] font-mono text-foreground p-3 overflow-x-auto whitespace-pre-wrap">
                            {impl.code}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* References */}
                {detail.references.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">References</p>
                    <div className="space-y-1">
                      {detail.references.map((r) => (
                        <a key={r} href={r} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline block break-all">
                          {r}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Source link */}
                <a
                  href={detail.sourceUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Open upstream YAML
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
