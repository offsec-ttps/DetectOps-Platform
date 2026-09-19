"use client";

import { useEffect, useState } from "react";
import {
  Library, ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCw, FileCode2, Cloud, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CommunityHit {
  id: string;
  source: "sigma" | "splunk" | "elastic";
  title: string;
  description: string;
  severity: string;
  language: string;
  techniques: string[];
  overlapCount: number;
  bodyPreview: string;
  internalHref: string;
}

interface Props {
  packId: string;
}

const SOURCE_META: Record<CommunityHit["source"], { label: string; color: string }> = {
  sigma:   { label: "SigmaHQ",       color: "border-accent/40 bg-accent/10 text-accent" },
  splunk:  { label: "Splunk ESCU",   color: "border-warning/40 bg-warning/10 text-warning" },
  elastic: { label: "Elastic Rules", color: "border-info/40 bg-info/10 text-info" },
};

export default function CommunityMatchesPanel({ packId }: Props) {
  const [data, setData] = useState<{ techniques: string[]; sigma: CommunityHit[]; splunk: CommunityHit[]; elastic: CommunityHit[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${packId}/community-matches?limit=8`);
      const j = await r.json();
      if (!r.ok) { setError(j.error || "load failed"); return; }
      setData(j);
    } catch (err: any) {
      setError(err?.message || "load failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [packId]);

  const toggle = (key: string) => {
    const n = new Set(expanded);
    if (n.has(key)) n.delete(key); else n.add(key);
    setExpanded(n);
  };

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Searching community catalogues…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
      </div>
    );
  }

  if (!data || data.techniques.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-4 text-center text-xs text-muted-foreground">
        No MITRE techniques mapped — community matches need at least one technique.
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/30 p-4 text-center text-xs text-muted-foreground">
        No community rules matched techniques {data.techniques.join(", ")}. Sync the catalogues at <a href="/community" className="text-accent hover:underline">/community</a>.
      </div>
    );
  }

  const groups = [
    { source: "sigma" as const,   items: data.sigma },
    { source: "splunk" as const,  items: data.splunk },
    { source: "elastic" as const, items: data.elastic },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <Library className="h-4 w-4 text-accent" />
        <h3 className="text-xs font-semibold text-foreground">Community detection logic that matches these techniques</h3>
        <span className="text-[10px] text-muted-foreground">{data.total} match(es) across {groups.length} source(s)</span>
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>
      <div className="divide-y divide-border">
        {groups.map(({ source, items }) => {
          const meta = SOURCE_META[source];
          return (
            <div key={source} className="px-4 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", meta.color)}>{meta.label}</span>
                <span className="text-[10px] text-muted-foreground">{items.length} rule{items.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-1">
                {items.map((h) => {
                  const isOpen = expanded.has(h.id);
                  return (
                    <div key={h.id} className="rounded border border-border bg-background/40">
                      <button onClick={() => toggle(h.id)} className="w-full text-left px-2 py-1.5 flex items-start gap-2">
                        {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground mt-0.5" /> : <ChevronRight className="h-3 w-3 text-muted-foreground mt-0.5" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <FileCode2 className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs font-medium text-foreground truncate">{h.title}</span>
                            <span className="text-[9px] uppercase font-mono px-1 rounded bg-muted/15 text-muted-foreground">{h.severity || "—"}</span>
                            <span className="text-[10px] text-muted-foreground">overlap: <span className="font-mono text-accent">{h.overlapCount}</span></span>
                            {h.techniques.slice(0, 3).map((t) => (
                              <span key={t} className="font-mono text-[10px] text-accent">{t}</span>
                            ))}
                          </div>
                          {h.description && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{h.description}</div>}
                        </div>
                        <a href={h.internalHref} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline mt-0.5" title="Open in Community Content">
                          open <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </button>
                      {isOpen && (
                        <pre className="px-3 py-2 border-t border-border text-[10px] font-mono text-foreground bg-background/60 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
{h.bodyPreview}{h.bodyPreview.length === 600 ? "\n…" : ""}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
