"use client";

/**
 * Canonical platform tags/symbols, shared across the atomics library and every
 * simulation use-case so platform coverage is consistent and scannable. Icons +
 * colored badges; clickable for filtering (pass onClick/active).
 */

import { Monitor, Terminal, Command, Cloud, Container, Ship, Smartphone, Server, Network, Building2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface Meta { label: string; Icon: any; cls: string }

const META: Record<string, Meta> = {
  windows: { label: "Windows", Icon: Monitor, cls: "text-[#60a5fa] border-[#60a5fa]/40 bg-[#60a5fa]/10" },
  linux: { label: "Linux", Icon: Terminal, cls: "text-warning border-warning/40 bg-warning/10" },
  macos: { label: "macOS", Icon: Command, cls: "text-muted-foreground border-border bg-muted/20" },
  aws: { label: "AWS", Icon: Cloud, cls: "text-[#ff9900] border-[#ff9900]/40 bg-[#ff9900]/10" },
  azure: { label: "Azure", Icon: Cloud, cls: "text-[#3ea0ff] border-[#3ea0ff]/40 bg-[#3ea0ff]/10" },
  gcp: { label: "GCP", Icon: Cloud, cls: "text-[#ea4335] border-[#ea4335]/40 bg-[#ea4335]/10" },
  docker: { label: "Docker", Icon: Container, cls: "text-[#2496ed] border-[#2496ed]/40 bg-[#2496ed]/10" },
  kubernetes: { label: "Kubernetes", Icon: Ship, cls: "text-[#326ce5] border-[#326ce5]/40 bg-[#326ce5]/10" },
  containers: { label: "Containers", Icon: Container, cls: "text-accent border-accent/40 bg-accent/10" },
  office365: { label: "Office 365", Icon: Building2, cls: "text-[#eb3c00] border-[#eb3c00]/40 bg-[#eb3c00]/10" },
  azuread: { label: "Entra ID", Icon: Building2, cls: "text-[#3ea0ff] border-[#3ea0ff]/40 bg-[#3ea0ff]/10" },
  gworkspace: { label: "Google WS", Icon: Globe, cls: "text-[#34a853] border-[#34a853]/40 bg-[#34a853]/10" },
  iaas: { label: "IaaS", Icon: Server, cls: "text-purple border-purple/40 bg-purple/10" },
  saas: { label: "SaaS", Icon: Cloud, cls: "text-purple border-purple/40 bg-purple/10" },
  android: { label: "Android", Icon: Smartphone, cls: "text-[#3ddc84] border-[#3ddc84]/40 bg-[#3ddc84]/10" },
  ios: { label: "iOS", Icon: Smartphone, cls: "text-muted-foreground border-border bg-muted/20" },
  network: { label: "Network", Icon: Network, cls: "text-info border-info/40 bg-info/10" },
};

const ALIAS: Record<string, string> = {
  "office-365": "office365", "o365": "office365", "m365": "office365",
  "azure-ad": "azuread", "entra": "azuread", "entra-id": "azuread",
  "google-workspace": "gworkspace", "gsuite": "gworkspace", "workspace": "gworkspace",
  "iaas:aws": "aws", "iaas:azure": "azure", "iaas:gcp": "gcp", "google-cloud": "gcp",
  "k8s": "kubernetes", "container": "containers", "osx": "macos", "mac": "macos",
};

export function normalizePlatform(p: string): string {
  const x = (p || "").trim().toLowerCase();
  return ALIAS[x] || x;
}

/** De-duplicated, canonical platform list for a set of raw platform strings. */
export function canonicalPlatforms(raw: string[]): string[] {
  const out: string[] = [];
  for (const p of raw) { const k = normalizePlatform(p); if (k && !out.includes(k)) out.push(k); }
  return out;
}

export function PlatformBadge({ platform, onClick, active, size = "sm" }: { platform: string; onClick?: () => void; active?: boolean; size?: "xs" | "sm" }) {
  const key = normalizePlatform(platform);
  const m = META[key] || { label: platform || "other", Icon: Server, cls: "text-muted-foreground border-border bg-muted/10" };
  const dims = size === "xs" ? "text-[9px] px-1 py-0.5 gap-0.5" : "text-[10px] px-1.5 py-0.5 gap-1";
  const icon = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  const cls = cn("inline-flex items-center rounded border font-medium whitespace-nowrap", dims,
    onClick && !active ? "border-border text-muted-foreground hover:text-foreground hover:border-accent/40" : m.cls);
  if (onClick) return <button type="button" onClick={onClick} className={cls} title={m.label}><m.Icon className={icon} /> {m.label}</button>;
  return <span className={cls} title={m.label}><m.Icon className={icon} /> {m.label}</span>;
}

export function PlatformBadges({ platforms, size = "sm", max }: { platforms: string[]; size?: "xs" | "sm"; max?: number }) {
  const list = canonicalPlatforms(platforms);
  const shown = max ? list.slice(0, max) : list;
  return (
    <span className="inline-flex flex-wrap gap-1 items-center">
      {shown.map((p) => <PlatformBadge key={p} platform={p} size={size} />)}
      {max && list.length > max && <span className="text-[9px] text-muted-foreground">+{list.length - max}</span>}
    </span>
  );
}
