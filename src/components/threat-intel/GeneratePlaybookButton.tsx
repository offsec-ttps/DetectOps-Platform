"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Loader2, AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReportLite {
  id: string;
  title: string;
  mitreTechniques?: unknown[];
}

/**
 * Generate Playbook button + modal — drops into any ThreatIntelReport view.
 *
 * Reads `/api/use-cases/ai/generations` once on mount to surface whether
 * Anthropic is configured server-side; disables the button with an inline
 * hint when not.
 */
export default function GeneratePlaybookButton({ report }: { report: ReportLite }) {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [wantAtomic, setWantAtomic] = useState(true);
  const [wantPS, setWantPS] = useState(true);
  const [withDetections, setWithDetections] = useState(true);
  const [model, setModel] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    useCaseId: string;
    totalCostUsd: number;
    totalTokens: { input: number; output: number };
  } | null>(null);

  useEffect(() => {
    fetch("/api/use-cases/ai/generations?pageSize=1")
      .then((r) => r.json())
      .then((d) => setConfigured(d?.config?.anthropic === "configured"))
      .catch(() => setConfigured(false));
  }, []);

  const run = async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      const frameworks: string[] = [];
      if (wantAtomic) frameworks.push("atomic");
      if (wantPS) frameworks.push("purplesharp");
      const res = await fetch("/api/use-cases/ai/from-ti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threatIntelReportId: report.id,
          frameworks,
          withDetectionSamples: withDetections,
          model: model || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "missing_api_key") setConfigured(false);
        setError(data.error || "Generation failed");
        return;
      }
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Generation failed");
    } finally { setRunning(false); }
  };

  const techniqueCount = (() => {
    const t = report.mitreTechniques;
    return Array.isArray(t) ? t.length : 0;
  })();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={configured === false}
        title={configured === false ? "Set ANTHROPIC_API_KEY in .env to enable AI generation" : "Generate a playbook from this threat report"}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors",
          configured === false
            ? "border border-border text-muted-foreground cursor-not-allowed opacity-60"
            : "bg-gradient-to-r from-[#3b82f6]/15 to-[#a855f7]/15 border border-accent/40 text-accent hover:from-[#3b82f6]/25 hover:to-[#a855f7]/25",
        )}
      >
        <Sparkles className="h-3 w-3" />
        Generate Playbook
        {configured === false && <span className="text-[10px] ml-1">(no API key)</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
          <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full mt-12">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" /> Generate playbook from threat
              </h3>
              <button onClick={() => { setOpen(false); setResult(null); setError(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">{report.title}</span>
                <span className="block mt-0.5">{techniqueCount} MITRE technique{techniqueCount !== 1 ? "s" : ""} mapped</span>
              </div>

              {!result && (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Frameworks</p>
                    <div className="flex gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                        <input type="checkbox" checked={wantAtomic} onChange={(e) => setWantAtomic(e.target.checked)} className="accent-[#3b82f6]" />
                        Atomic Red Team
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                        <input type="checkbox" checked={wantPS} onChange={(e) => setWantPS(e.target.checked)} className="accent-[#a855f7]" />
                        PurpleSharp
                      </label>
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                    <input type="checkbox" checked={withDetections} onChange={(e) => setWithDetections(e.target.checked)} className="accent-[#3b82f6]" />
                    Include detection samples (Sigma / SPL / KQL)
                  </label>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Model</p>
                    <select
                      value={model} onChange={(e) => setModel(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
                    >
                      <option value="">Default (claude-opus-4-7 for playbooks, claude-sonnet-4-6 for detections)</option>
                      <option value="claude-opus-4-7">claude-opus-4-7 (deeper reasoning, slower, $$$)</option>
                      <option value="claude-sonnet-4-6">claude-sonnet-4-6 (faster, cheaper)</option>
                      <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (fastest, cheapest)</option>
                    </select>
                  </div>
                </>
              )}

              {error && (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {result && (
                <div className="rounded-md border border-success/30 bg-success/10 px-3 py-3 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-medium">Playbook generated</span>
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    {result.totalTokens.input} in · {result.totalTokens.output} out · ${result.totalCostUsd.toFixed(4)}
                  </div>
                  <Link
                    href={`/use-cases/${result.useCaseId}`}
                    className="inline-flex items-center gap-1 text-accent hover:text-[#60a5fa] font-medium"
                  >
                    Open Use Case <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              {!result ? (
                <>
                  <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                  <button
                    onClick={run}
                    disabled={running || (!wantAtomic && !wantPS) || configured === false}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
                  >
                    {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Generate
                  </button>
                </>
              ) : (
                <button onClick={() => { setOpen(false); setResult(null); }} className="text-xs text-accent hover:text-[#60a5fa] font-medium">Close</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
