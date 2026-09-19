"use client";

import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type CoverageOutcome = "matched" | "partial" | "missed" | "error" | "n/a" | "";

interface Props {
  outcome: CoverageOutcome;
  mode?: "simulate-only" | "simulate-and-validate";
  size?: "sm" | "md";
  showLabel?: boolean;
}

const STYLES: Record<string, { color: string; Icon: React.ComponentType<{ className?: string }>; label: string }> = {
  matched: { color: "bg-success/15 text-success border-success/40", Icon: CheckCircle2,  label: "matched" },
  partial: { color: "bg-warning/15 text-warning border-warning/40", Icon: AlertTriangle, label: "partial" },
  missed:  { color: "bg-danger/15 text-danger border-danger/40",    Icon: XCircle,       label: "missed"  },
  error:   { color: "bg-danger/15 text-danger border-danger/40",    Icon: AlertTriangle, label: "error"   },
  "n/a":   { color: "bg-muted/15 text-muted-foreground border-border", Icon: HelpCircle, label: "n/a"     },
  "":      { color: "bg-muted/15 text-muted-foreground border-border", Icon: Clock,      label: "pending" },
};

export default function CoverageBadge({ outcome, mode, size = "sm", showLabel = true }: Props) {
  // simulate-only runs should not surface a coverage verdict at all
  const effectiveOutcome = mode === "simulate-only" ? "n/a" : outcome;
  const s = STYLES[effectiveOutcome] || STYLES[""];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-bold uppercase",
        s.color,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
      )}
      title={`Detection coverage: ${s.label}${mode === "simulate-only" ? " (simulate-only run; coverage not measured)" : ""}`}
    >
      <s.Icon className={cn(size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
      {showLabel && s.label}
    </span>
  );
}
