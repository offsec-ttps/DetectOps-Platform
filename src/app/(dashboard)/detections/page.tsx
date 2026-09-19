"use client";

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  FileCode2,
  Search,
  Filter,
  Plus,
  Download,
  ChevronRight,
  Shield,
  Eye,
  Pencil,
  Play,
  MoreHorizontal,
} from "lucide-react";

type Rule = {
  id: string;
  name: string;
  severity: string;
  status: string;
  technique: string;
  logSource: string;
  lastTested: string;
  rd: number;
};

const rules: Rule[] = [];

const sevDot: Record<string, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
};
const statusBadge: Record<string, string> = {
  active: "bg-status-active/15 text-status-active border-status-active/30",
  draft: "bg-status-draft/15 text-status-draft border-status-draft/30",
  review: "bg-status-review/15 text-status-review border-status-review/30",
  testing: "bg-status-testing/15 text-status-testing border-status-testing/30",
  deprecated: "bg-status-deprecated/15 text-status-deprecated border-status-deprecated/30",
};

export default function DetectionsPage() {
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => rules.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !r.technique.toLowerCase().includes(search.toLowerCase())) return false;
    if (sevFilter !== "all" && r.severity !== sevFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    return true;
  }), [search, sevFilter, statusFilter]);

  const counts = { total: 0, active: 0, review: 0, draft: 0 };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Detections & Use Cases</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted">
            <span>{counts.total} Total</span>
            <span className="text-success">{counts.active} Active</span>
            <span className="text-warning">{counts.review} In Review</span>
            <span className="text-muted-foreground">{counts.draft} Draft</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
            <Download className="h-4 w-4" /> Import
          </button>
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <Plus className="h-4 w-4" /> New Detection
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input type="text" placeholder="Search detections by name or technique…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus" />
        </div>
        <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)} className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="testing">Testing</option>
          <option value="review">Review</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-card-hover">
              <th className="w-8 px-4 py-3"></th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Detection Rule</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Status</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Log Source</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Last Tested</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Reliability</th>
              <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? (
              filtered.map((rule) => (
                <tr key={rule.id} className="group border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-4 py-3"><div className={cn("h-2.5 w-2.5 rounded-full", sevDot[rule.severity])} /></td>
                  <td className="px-4 py-3">
                    <Link href={`/detections/${rule.id}`} className="group-hover:text-accent transition-colors">
                      <p className="text-sm font-medium text-foreground group-hover:text-accent">{rule.name}</p>
                      <span className="mt-0.5 inline-block rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-accent">{rule.technique}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", statusBadge[rule.status])}>{rule.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{rule.logSource}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{rule.lastTested}</td>
                  <td className="px-4 py-3">
                    {rule.rd > 0 ? (
                      <span className={cn("text-xs font-bold", rule.rd >= 0.8 ? "text-success" : rule.rd >= 0.6 ? "text-warning" : "text-danger")}>{rule.rd.toFixed(2)}</span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="rounded p-1 hover:bg-background" title="View"><Eye className="h-3.5 w-3.5 text-muted" /></button>
                      <button className="rounded p-1 hover:bg-background" title="Edit"><Pencil className="h-3.5 w-3.5 text-muted" /></button>
                      <button className="rounded p-1 hover:bg-background" title="Test"><Play className="h-3.5 w-3.5 text-muted" /></button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Shield className="h-10 w-10 text-muted" />
                    <p className="text-sm text-muted-foreground">
                      No detection rules yet. Create rules in the Rule Workspace or import from community sources.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{filtered.length} of {rules.length} detections shown</p>
    </div>
  );
}
