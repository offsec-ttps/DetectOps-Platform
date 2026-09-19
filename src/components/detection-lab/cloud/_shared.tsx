"use client";

/**
 * Shared helpers and small primitive components used across Cloud tab parts.
 */

import { Globe } from "lucide-react";
import type { SarProvider, SarStatus } from "@/types/sar";
import { cn } from "@/lib/utils";

export function ProviderIcon({ provider, className }: { provider: SarProvider; className?: string }) {
  const c: Record<SarProvider, string> = {
    aws: "text-[#FF9900]", azure: "text-[#0078D4]", gcp: "text-[#4285F4]",
  };
  return <Globe className={cn("h-3.5 w-3.5", c[provider], className)} />;
}

export function statusStyle(s: SarStatus): string {
  switch (s) {
    case "running":
    case "completed":
      return "text-success bg-success/10 border-success/30";
    case "failed":
    case "error":
    case "aborted":
      return "text-danger bg-danger/10 border-danger/30";
    case "wait_for_vpn":
      return "text-warning bg-warning/10 border-warning/30";
    default:
      return "text-accent bg-accent/10 border-accent/30";
  }
}

export function fmtStatus(s: SarStatus): string {
  return s.replace(/_/g, " ");
}

export async function copyToClipboard(txt: string): Promise<void> {
  try { await navigator.clipboard.writeText(txt); } catch { /* ignore */ }
}

export function downloadText(txt: string, filename: string): void {
  const blob = new Blob([txt], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function durationText(from?: string | null, to?: string | null): string {
  if (!from) return "—";
  const end = to ? new Date(to).getTime() : Date.now();
  const start = new Date(from).getTime();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
