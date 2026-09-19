import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(date);
}

export function severityColor(severity: string): string {
  const map: Record<string, string> = {
    critical: "text-severity-critical bg-severity-critical/15 border-severity-critical/30",
    high: "text-severity-high bg-severity-high/15 border-severity-high/30",
    medium: "text-severity-medium bg-severity-medium/15 border-severity-medium/30",
    low: "text-severity-low bg-severity-low/15 border-severity-low/30",
    informational: "text-severity-info bg-severity-info/15 border-severity-info/30",
  };
  return map[severity] ?? map.informational;
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    active: "text-status-active bg-status-active/15 border-status-active/30",
    draft: "text-status-draft bg-status-draft/15 border-status-draft/30",
    review: "text-status-review bg-status-review/15 border-status-review/30",
    testing: "text-status-testing bg-status-testing/15 border-status-testing/30",
    deprecated: "text-status-deprecated bg-status-deprecated/15 border-status-deprecated/30",
    archived: "text-status-archived bg-status-archived/15 border-status-archived/30",
    // Test run statuses
    pending: "text-status-draft bg-status-draft/15 border-status-draft/30",
    running: "text-accent bg-accent/15 border-accent/30",
    success: "text-status-active bg-status-active/15 border-status-active/30",
    failure: "text-status-deprecated bg-status-deprecated/15 border-status-deprecated/30",
    error: "text-severity-critical bg-severity-critical/15 border-severity-critical/30",
  };
  return map[status] ?? map.draft;
}

export function coverageColor(level: number): string {
  if (level === 0) return "bg-coverage-none";
  if (level < 0.3) return "bg-coverage-low";
  if (level < 0.6) return "bg-coverage-partial";
  if (level < 0.9) return "bg-coverage-good";
  return "bg-coverage-full";
}

export function reliabilityLabel(rd: number): { label: string; color: string } {
  if (rd >= 0.9) return { label: "Excellent", color: "text-success" };
  if (rd >= 0.7) return { label: "Good", color: "text-accent" };
  if (rd >= 0.5) return { label: "Fair", color: "text-warning" };
  return { label: "Poor", color: "text-danger" };
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "…";
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
