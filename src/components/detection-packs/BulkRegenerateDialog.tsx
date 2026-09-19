"use client";

import { useEffect, useState } from "react";
import {
  Wand2, X, Loader2, AlertTriangle, CheckCircle2, FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES = ["", "web", "network", "os-windows", "os-linux", "os-macos", "cloud", "identity", "email", "third-party", "other"];
const SEVERITIES = ["", "critical", "high", "medium", "low", "info"];
const STATUSES = ["", "draft", "test", "tune", "validate", "production"];
const PROVIDERS = ["", "anthropic", "openai", "openrouter", "nvidia", "ollama"];

interface DryRun { matched: number; dryRunMatches: string[] }
interface BulkResult {
  matched: number;
  processed: number;
  succeeded: Array<{ originalPackId: string; newPackId: string; costUsd: number }>;
  failed:    Array<{ packId: string; error: string }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a non-dry-run regen completes so the parent can refresh the list. */
  onRegenerated?: () => void;
}

export default function BulkRegenerateDialog({ open, onClose, onRegenerated }: Props) {
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [ageBefore, setAgeBefore] = useState("");
  const [provider, setProvider] = useState("");
  const [packModel, setPackModel] = useState("");
  const [irpModel, setIrpModel] = useState("");
  const [limit, setLimit] = useState(20);

  const [busy, setBusy] = useState<"dry" | "go" | null>(null);
  const [dryResult, setDryResult] = useState<DryRun | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setDryResult(null); setResult(null); setError(null); setBusy(null); }
  }, [open]);

  if (!open) return null;

  const buildBody = (dryRun: boolean) => ({
    filter: {
      ...(category ? { category } : {}),
      ...(severity ? { severity } : {}),
      ...(status ? { status } : {}),
      ...(ageBefore ? { ageBefore: new Date(ageBefore).toISOString() } : {}),
    },
    ...(provider ? { provider } : {}),
    ...(packModel ? { packModel } : {}),
    ...(irpModel ? { irpModel } : {}),
    limit,
    dryRun,
  });

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "dry" : "go"); setError(null);
    if (dryRun) setDryResult(null); else setResult(null);
    try {
      const res = await fetch("/api/detection-packs/bulk-regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(dryRun)),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Bulk regenerate failed"); return; }
      if (dryRun) setDryResult(data);
      else { setResult(data); onRegenerated?.(); }
    } catch (err: any) {
      setError(err?.message || "Bulk regenerate failed");
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Bulk regenerate</h2>
          <button onClick={onClose} className="ml-auto p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-info">
            Re-runs the LLM for every pack that matches the filter. New packs land with a <code className="font-mono">-v2</code> / <code className="font-mono">-v3</code> slug so old ones stay linked to their GitHub issues. Bypasses the auto-pipeline queue.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                {CATEGORIES.map((c) => <option key={c || "all"} value={c}>{c || "any"}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                {SEVERITIES.map((c) => <option key={c || "all"} value={c}>{c || "any"}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                {STATUSES.map((c) => <option key={c || "all"} value={c}>{c || "any"}</option>)}
              </select>
            </Field>
            <Field label="Updated before">
              <input type="date" value={ageBefore} onChange={(e) => setAgeBefore(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
            <Field label="Provider">
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                {PROVIDERS.map((p) => <option key={p || "default"} value={p}>{p || "default"}</option>)}
              </select>
            </Field>
            <Field label="Limit (max 200)">
              <input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(200, parseInt(e.target.value || "1", 10))))}
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
            <Field label="Pack model (override)">
              <input type="text" value={packModel} onChange={(e) => setPackModel(e.target.value)} placeholder="claude-sonnet-4-6"
                className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
            <Field label="IRP model (override)">
              <input type="text" value={irpModel} onChange={(e) => setIrpModel(e.target.value)} placeholder="claude-opus-4-7"
                className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
          </div>

          {dryResult && (
            <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-info inline-flex items-start gap-2">
              <FlaskConical className="h-3.5 w-3.5 mt-0.5" />
              Dry run: <strong>{dryResult.matched}</strong> pack{dryResult.matched !== 1 ? "s" : ""} would be regenerated.
            </div>
          )}
          {result && (
            <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11px] text-success space-y-1">
              <div className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />
                Processed <strong>{result.processed}</strong> of {result.matched} · <strong>{result.succeeded.length}</strong> ok · <strong>{result.failed.length}</strong> failed.
              </div>
              {result.succeeded.length > 0 && (
                <div className="font-mono text-[10px] text-success">
                  Total cost: ${result.succeeded.reduce((s, x) => s + (x.costUsd || 0), 0).toFixed(4)}
                </div>
              )}
              {result.failed.length > 0 && (
                <details className="text-[10px]">
                  <summary className="cursor-pointer text-danger">View {result.failed.length} failure(s)</summary>
                  <ul className="mt-1 ml-3 list-disc text-danger">
                    {result.failed.slice(0, 5).map((f, i) => (
                      <li key={i}><span className="font-mono">{f.packId.slice(0, 8)}</span>: {f.error.slice(0, 100)}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger inline-flex items-start gap-2 w-full">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground hover:text-foreground">
            {result ? "Close" : "Cancel"}
          </button>
          <button
            onClick={() => run(true)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded border border-info/40 text-info hover:bg-info/10 disabled:opacity-50"
          >
            {busy === "dry" ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
            Dry run
          </button>
          <button
            onClick={() => {
              if (!confirm(`Regenerate ${dryResult?.matched ?? "matching"} pack(s)? This will call the LLM and incur cost.`)) return;
              run(false);
            }}
            disabled={busy !== null || !!result}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded text-white",
              "bg-gradient-to-r from-info to-purple hover:opacity-90 disabled:opacity-50",
            )}
          >
            {busy === "go" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}
