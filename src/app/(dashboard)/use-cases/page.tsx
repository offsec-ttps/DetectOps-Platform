"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Layers, Plus, FlaskConical, Workflow, FileCode2, Loader2, ArrowUpRight, Archive, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface UseCaseRow {
  id: string;
  name: string;
  description: string;
  authorMode: string;
  framework: string;
  source: string;
  status: string;
  mitreTechniques: string[];
  platforms: string[];
  tags: string[];
  stepCount: number;
  playbookCount: number;
  updatedAt: string;
  createdAt: string;
}

export default function UseCasesLandingPage() {
  const [rows, setRows] = useState<UseCaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const url = new URL("/api/use-cases", window.location.origin);
      if (filter) url.searchParams.set("authorMode", filter);
      if (sourceFilter) url.searchParams.set("source", sourceFilter);
      const res = await fetch(url);
      const data = await res.json();
      setRows(data.items || []);
      setTotal(data.total || 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, sourceFilter]);

  const stats = {
    total,
    drafts: rows.filter((r) => r.status === "draft").length,
    atomic: rows.filter((r) => r.authorMode === "atomic").length,
    purplesharp: rows.filter((r) => r.authorMode === "purplesharp").length,
    canvas: rows.filter((r) => r.authorMode === "canvas").length,
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Layers className="h-6 w-6 text-accent" />
            Use Case Builder
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose adversary scenarios across Atomic Red Team, PurpleSharp, and Stratus. Export ready-to-run playbooks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/use-cases/upload"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-border text-foreground hover:bg-card-hover text-sm font-medium transition-colors"
          >
            <Upload className="h-4 w-4" /> Upload detection
          </Link>
          <Link
            href="/use-cases/new"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-accent hover:bg-[#60a5fa] text-white text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> New Use Case
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats.total, hint: "" },
          { label: "Drafts", value: stats.drafts, hint: "in progress" },
          { label: "ART", value: stats.atomic, hint: "authored" },
          { label: "PurpleSharp", value: stats.purplesharp, hint: "authored" },
          { label: "Canvas", value: stats.canvas, hint: "drag-and-drop" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-2xl font-bold text-foreground">{s.value}</div>
            {s.hint && <div className="text-[11px] text-muted-foreground">{s.hint}</div>}
          </div>
        ))}
      </div>

      {/* Mode picker (quick-access) */}
      <div className="grid md:grid-cols-3 gap-4">
        <ModeCard
          href="/use-cases/atomic"
          icon={<FlaskConical className="h-6 w-6" />}
          title="Atomic Red Team"
          desc="Visually craft ART YAML tests with the AtomicGen-style builder."
        />
        <ModeCard
          href="/use-cases/purplesharp"
          icon={<FileCode2 className="h-6 w-6" />}
          title="PurpleSharp"
          desc="Build PurpleSharp JSON playbooks from technique variations."
        />
        <ModeCard
          href="/use-cases/canvas"
          icon={<Workflow className="h-6 w-6" />}
          title="Workflow Canvas"
          desc="Drag-and-drop ATT&CK steps across frameworks; choose output at export."
        />
      </div>

      {/* Recent list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Recent Use Cases</h2>
          <div className="flex items-center gap-3 text-[11px]">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground mr-1">Mode:</span>
              {["", "atomic", "purplesharp", "canvas"].map((m) => (
                <button
                  key={m || "all"}
                  onClick={() => setFilter(m)}
                  className={cn(
                    "px-2 py-1 rounded-md transition-colors",
                    filter === m
                      ? "bg-accent/15 text-accent border border-accent/30"
                      : "text-muted-foreground hover:text-foreground border border-transparent",
                  )}
                >
                  {m === "" ? "all" : m}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground mr-1">Source:</span>
              {["", "manual", "ti", "rule"].map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => setSourceFilter(s)}
                  className={cn(
                    "px-2 py-1 rounded-md transition-colors",
                    sourceFilter === s
                      ? "bg-purple/15 text-purple border border-purple/30"
                      : "text-muted-foreground hover:text-foreground border border-transparent",
                  )}
                >
                  {s === "" ? "all" : s}
                </button>
              ))}
            </div>
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Layers className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No use cases yet. Click "New Use Case" to start.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/use-cases/${r.id}`}
                className="block px-4 py-3 hover:bg-card-hover transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                        r.authorMode === "atomic" ? "bg-accent/15 text-accent" :
                        r.authorMode === "purplesharp" ? "bg-purple/15 text-purple" :
                        "bg-info/15 text-info",
                      )}>
                        {r.authorMode}
                      </span>
                      {r.status === "archived" && (
                        <span className="text-[10px] inline-flex items-center gap-1 text-muted-foreground"><Archive className="h-3 w-3" /> archived</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.stepCount} step{r.stepCount !== 1 ? "s" : ""} ·{" "}
                      {r.playbookCount} playbook{r.playbookCount !== 1 ? "s" : ""} ·{" "}
                      {r.mitreTechniques.length > 0 ? r.mitreTechniques.slice(0, 3).join(", ") : "no techniques"}
                      {r.mitreTechniques.length > 3 ? ` +${r.mitreTechniques.length - 3}` : ""}
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeCard({ href, icon, title, desc, comingSoon = false }: {
  href: string; icon: React.ReactNode; title: string; desc: string; comingSoon?: boolean;
}) {
  return (
    <Link
      href={comingSoon ? "#" : href}
      onClick={(e) => { if (comingSoon) e.preventDefault(); }}
      className={cn(
        "block rounded-xl border bg-card p-5 transition-all",
        comingSoon
          ? "border-border opacity-50 cursor-not-allowed"
          : "border-border hover:border-accent/40 hover:bg-card-hover",
      )}
    >
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
        {icon}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {comingSoon && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning uppercase">soon</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </Link>
  );
}
