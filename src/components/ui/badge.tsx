"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "severity" | "status" | "outline";
  severity?: "critical" | "high" | "medium" | "low" | "informational";
  status?: "active" | "draft" | "review" | "testing" | "deprecated" | "archived" | "pending" | "running" | "success" | "failure" | "error";
  size?: "sm" | "md";
  className?: string;
}

const severityStyles: Record<string, string> = {
  critical: "bg-severity-critical/15 text-severity-critical border-severity-critical/30",
  high: "bg-severity-high/15 text-severity-high border-severity-high/30",
  medium: "bg-severity-medium/15 text-severity-medium border-severity-medium/30",
  low: "bg-severity-low/15 text-severity-low border-severity-low/30",
  informational: "bg-muted/15 text-muted-foreground border-muted/30",
};

const statusStyles: Record<string, string> = {
  active: "bg-status-active/15 text-status-active border-status-active/30",
  draft: "bg-status-draft/15 text-status-draft border-status-draft/30",
  review: "bg-status-review/15 text-status-review border-status-review/30",
  testing: "bg-status-testing/15 text-status-testing border-status-testing/30",
  deprecated: "bg-status-deprecated/15 text-status-deprecated border-status-deprecated/30",
  archived: "bg-status-archived/15 text-status-archived border-status-archived/30",
  pending: "bg-status-draft/15 text-status-draft border-status-draft/30",
  running: "bg-accent/15 text-accent border-accent/30",
  success: "bg-status-active/15 text-status-active border-status-active/30",
  failure: "bg-status-deprecated/15 text-status-deprecated border-status-deprecated/30",
  error: "bg-severity-critical/15 text-severity-critical border-severity-critical/30",
};

export function Badge({ children, variant = "default", severity, status, size = "sm", className }: BadgeProps) {
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";

  let variantClass = "bg-accent/15 text-accent border-accent/30";
  if (variant === "severity" && severity) variantClass = severityStyles[severity] ?? variantClass;
  else if (variant === "status" && status) variantClass = statusStyles[status] ?? variantClass;
  else if (variant === "outline") variantClass = "bg-transparent text-muted-foreground border-border";

  return (
    <span className={cn("inline-flex items-center rounded-full border font-semibold", sizeClass, variantClass, className)}>
      {children}
    </span>
  );
}
