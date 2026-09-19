"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2, XCircle, AlertTriangle, MinusCircle, Loader2, RefreshCw, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Check {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skip";
  message: string;
  fixHint?: string;
}

export interface PreflightResult {
  verdict: "green" | "yellow" | "red" | "pending";
  checks: Check[];
  runnable: boolean;
  destructive: boolean;
  generatedAt: string;
}

interface Props {
  packId: string;
  scenarioId: string;
  environmentId: string;
  mode: "simulate-only" | "simulate-and-validate";
  onResult?: (r: PreflightResult) => void;
}

const STATUS: Record<Check["status"], { color: string; Icon: React.ComponentType<{ className?: string }> }> = {
  ok:   { color: "text-success",         Icon: CheckCircle2  },
  warn: { color: "text-warning",         Icon: AlertTriangle },
  fail: { color: "text-danger",          Icon: XCircle       },
  skip: { color: "text-muted-foreground", Icon: MinusCircle  },
};

const VERDICT: Record<PreflightResult["verdict"], { color: string; label: string }> = {
  green:   { color: "border-success/40 bg-success/10 text-success",     label: "READY" },
  yellow:  { color: "border-warning/40 bg-warning/10 text-warning",     label: "CAUTION" },
  red:     { color: "border-danger/40 bg-danger/10 text-danger",        label: "BLOCKED" },
  pending: { color: "border-border bg-muted/10 text-muted-foreground",  label: "PENDING" },
};

export default function PreflightPanel({ packId, scenarioId, environmentId, mode, onResult }: Props) {
  const [data, setData] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!scenarioId || !environmentId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ scenarioId, environmentId, mode });
      const r = await fetch(`/api/enterprise-use-cases/${packId}/preflight?${params}`);
      const d = await r.json();
      if (!r.ok) { setError(d.error || "preflight failed"); return; }
      setData(d);
      onResult?.(d);
    } catch (err: any) {
      setError(err?.message || "preflight failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [packId, scenarioId, environmentId, mode]);

  if (!scenarioId || !environmentId) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/30 p-3 text-[11px] text-muted-foreground text-center">
        Pick a scenario and environment to see the readiness checklist.
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="rounded-md border border-border bg-card p-3 text-[11px] text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Running preflight…
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

  if (!data) return null;
  const v = VERDICT[data.verdict];

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-semibold text-foreground">Prerequisites &amp; Validation</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", v.color)}>{v.label}</span>
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> rerun
        </button>
      </div>
      <div className="divide-y divide-border max-h-72 overflow-y-auto">
        {data.checks.map((c) => {
          const s = STATUS[c.status];
          return (
            <div key={c.id} className="px-3 py-1.5 flex items-start gap-2 text-[11px]">
              <s.Icon className={cn("h-3 w-3 mt-0.5 flex-shrink-0", s.color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className={cn("uppercase text-[9px] font-bold", s.color)}>{c.status}</span>
                </div>
                <div className="text-muted-foreground">{c.message}</div>
                {c.fixHint && <div className="text-[10px] text-info mt-0.5">→ {c.fixHint}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {data.destructive && (
        <div className="px-3 py-1.5 border-t border-warning/40 bg-warning/5 text-[10px] text-warning">
          ⚠ destructive run (env kind may create live resources / call back to a real listener)
        </div>
      )}
    </div>
  );
}
