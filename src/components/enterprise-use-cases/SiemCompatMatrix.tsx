"use client";

import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

type Verdict = "ok" | "warn" | "fail" | "skip";

const BACKENDS: Array<{ id: string; label: string }> = [
  { id: "splunk", label: "Splunk SPL" },
  { id: "kusto",  label: "Sentinel KQL" },
  { id: "esql",   label: "Elastic ES|QL" },
  { id: "lucene", label: "Elastic Lucene" },
];

const STYLES: Record<Verdict, { color: string; Icon: React.ComponentType<{ className?: string }>; label: string }> = {
  ok:   { color: "text-success",         Icon: CheckCircle2,  label: "ok"   },
  warn: { color: "text-warning",         Icon: AlertTriangle, label: "warn" },
  fail: { color: "text-danger",          Icon: XCircle,       label: "fail" },
  skip: { color: "text-muted-foreground", Icon: MinusCircle,  label: "skip" },
};

interface Props {
  matrix: Record<string, string>;
  format?: string;
  compact?: boolean;
}

export default function SiemCompatMatrix({ matrix, format, compact }: Props) {
  const empty = !matrix || Object.keys(matrix).length === 0;
  const isSigma = format === "sigma" || format === "yaml";

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {BACKENDS.map((b) => {
          const v = (matrix?.[b.id] || "skip") as Verdict;
          const s = STYLES[v] || STYLES.skip;
          return (
            <span key={b.id} className="inline-flex items-center gap-0.5" title={`${b.label}: ${s.label}`}>
              <s.Icon className={cn("h-3 w-3", s.color)} />
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <Terminal className="h-3 w-3 text-accent" />
        <h3 className="text-xs font-semibold text-foreground">SIEM compatibility</h3>
        {!isSigma && (
          <span className="text-[10px] text-muted-foreground ml-auto">format=<span className="font-mono">{format || "unknown"}</span> · Sigma compat is computed only for Sigma rules</span>
        )}
      </div>
      {empty ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">No compatibility data yet — click <span className="font-mono">Re-validate</span> to populate.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
          {BACKENDS.map((b) => {
            const v = (matrix?.[b.id] || "skip") as Verdict;
            const s = STYLES[v] || STYLES.skip;
            return (
              <div key={b.id} className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5">
                <s.Icon className={cn("h-4 w-4 flex-shrink-0", s.color)} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">{b.label}</div>
                  <div className={cn("text-[10px] uppercase tracking-wider font-mono", s.color)}>{s.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
