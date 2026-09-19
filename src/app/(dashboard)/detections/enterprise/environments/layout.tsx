"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Server, Cpu, Swords, BarChart3, Library } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tab hub for Enterprise Environments. Everything in the Adversary-Simulation
 * build nests here rather than as new top-level sidebar entries:
 *   Environments (registry) · Fleet · Campaigns · Detection Scoreboard · C2 Library
 *
 * Environments + Fleet are live (M1). The rest are tagged "soon" until their
 * milestone lands (campaigns M4 · scoreboard M6 · C2 Library Track 3).
 */
const TABS: Array<{ label: string; href: string; Icon: React.ComponentType<{ className?: string }>; soon?: string }> = [
  { label: "Environments", href: "/detections/enterprise/environments", Icon: Server },
  { label: "Fleet Simulation", href: "/detections/enterprise/environments/fleet", Icon: Cpu },
  { label: "Scoreboard",   href: "/detections/enterprise/environments/scoreboard", Icon: BarChart3, soon: "M6" },
  { label: "C2 Library",   href: "/detections/enterprise/environments/c2-frameworks", Icon: Library, soon: "soon" },
];

export default function EnvironmentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const base = "/detections/enterprise/environments";

  return (
    <div>
      <div className="px-6 pt-5">
        <div className="border-b border-border flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
            if (t.soon) {
              return (
                <span
                  key={t.href}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 border-transparent text-muted-foreground/50 whitespace-nowrap cursor-not-allowed"
                  title={`Ships in ${t.soon}`}
                >
                  <t.Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <span className="text-[9px] uppercase tracking-wider px-1 rounded bg-muted/15">{t.soon}</span>
                </span>
              );
            }
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                  active ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <t.Icon className="h-3.5 w-3.5" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}
