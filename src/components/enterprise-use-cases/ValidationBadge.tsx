"use client";

import { CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type ValidationVerdict = "green" | "yellow" | "red" | "pending";

interface Props {
  status: ValidationVerdict;
  details?: { checks?: Record<string, { ok: boolean; severity: string; message: string }> };
  size?: "sm" | "md";
  showHover?: boolean;
}

const STYLES: Record<ValidationVerdict, { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }> = {
  green:   { label: "green",   className: "bg-success/15 text-success border-success/40",  Icon: CheckCircle2 },
  yellow:  { label: "yellow",  className: "bg-warning/15 text-warning border-warning/40",  Icon: AlertTriangle },
  red:     { label: "red",     className: "bg-danger/15 text-danger border-danger/40",     Icon: XCircle },
  pending: { label: "pending", className: "bg-muted/15 text-muted-foreground border-border", Icon: Clock },
};

export default function ValidationBadge({ status, details, size = "sm", showHover = true }: Props) {
  const s = STYLES[status] || STYLES.pending;
  const failed = details?.checks
    ? Object.entries(details.checks).filter(([, c]) => !c.ok)
    : [];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-bold uppercase",
        s.className,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
      )}
      title={showHover && failed.length ? failed.map(([k, c]) => `${k}: ${c.message}`).join("\n") : s.label}
    >
      <s.Icon className={cn(size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
      {s.label}
    </span>
  );
}
