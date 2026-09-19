"use client";

import { useState } from "react";
import {
  Rocket, Loader2, X, AlertTriangle, CheckCircle2, ExternalLink, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  packId: string;
  ucStatus: string;
  hasMatchedRun?: boolean;
  onPromoted?: (result: { detectionPackId: string; slug: string; reusedExisting: boolean }) => void;
}

export default function PromoteButton({ packId, ucStatus, hasMatchedRun, onPromoted }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsForce, setNeedsForce] = useState(false);
  const [done, setDone] = useState<{ detectionPackId: string; slug: string; reusedExisting: boolean } | null>(null);

  const canPromote = ucStatus === "validated" || ucStatus === "promoted" || hasMatchedRun;
  const alreadyPromoted = ucStatus === "promoted";

  const doPromote = async (force: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${packId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await r.json();
      if (r.status === 409 && data.code === "not_validated") {
        setNeedsForce(true);
        setError(data.error);
        return;
      }
      if (!r.ok) { setError(data.error || "promote failed"); return; }
      setDone(data);
      onPromoted?.(data);
    } catch (err: any) {
      setError(err?.message || "promote failed");
    } finally { setBusy(false); }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={!canPromote && !alreadyPromoted}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md",
          alreadyPromoted
            ? "bg-accent/10 text-accent border border-accent/40"
            : canPromote
              ? "bg-success text-white hover:opacity-90"
              : "bg-muted/15 text-muted-foreground cursor-not-allowed",
        )}
        title={
          alreadyPromoted ? "Already promoted to a Detection Pack — open dialog to view"
            : canPromote ? "Promote validated use case to a Detection Pack row"
            : "Run a scenario that matches in simulate-and-validate first"
        }
      >
        <Rocket className="h-3.5 w-3.5" />
        {alreadyPromoted ? "Promoted" : "Promote to Pack"}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-y-auto">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Rocket className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-foreground">Promote to Detection Pack</h2>
              <button onClick={() => setOpen(false)} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="px-5 py-2 border-b border-danger/30 bg-danger/10 text-xs text-danger inline-flex items-center gap-2 w-full">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </div>
            )}

            <div className="p-5 space-y-3">
              {done ? (
                <>
                  <div className="rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success inline-flex items-center gap-2 w-full">
                    <CheckCircle2 className="h-4 w-4" />
                    {done.reusedExisting ? "Reused existing Detection Pack" : "Created Detection Pack"} <span className="font-mono">{done.slug}</span>
                  </div>
                  <a href={`/detections/packs/${done.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    View in Detection Packs <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Promoting copies the <strong>selected</strong> detection logic body into a new <code>DetectionPack</code> row,
                    carries over auto-suggested simulations from the matched scenario, and creates an IRP scaffold. The use case
                    status flips to <code>promoted</code>.
                  </p>
                  {needsForce && (
                    <div className="rounded border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-foreground space-y-1">
                      <div className="inline-flex items-center gap-1.5 text-warning font-semibold uppercase">
                        <ShieldAlert className="h-3.5 w-3.5" /> Force promote
                      </div>
                      <p>No matched non-stub run exists. Promoting now creates a pack with rule <code>validationStatus="unvalidated"</code>.</p>
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setOpen(false)} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                    <button
                      onClick={() => doPromote(needsForce)}
                      disabled={busy}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs h-8 px-4 rounded text-white disabled:opacity-50",
                        needsForce ? "bg-warning hover:opacity-90" : "bg-success hover:opacity-90",
                      )}
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                      {needsForce ? "Force promote" : "Promote"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
