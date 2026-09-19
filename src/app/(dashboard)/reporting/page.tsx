"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  BarChart3, FileText, BookOpen, TrendingDown, Clock, Shield,
  AlertTriangle, CheckCircle, Plus, GitBranch, Loader2, X, Search,
  ChevronRight, ChevronDown, ExternalLink, Play, Eye, Pencil,
  Trash2, RefreshCw, CheckCircle2, XCircle, Download,
} from "lucide-react";

// ── Types ──

interface Simulation {
  id?: string;
  description: string;
  output: string;
  order: number;
}

interface Report {
  id: string;
  name: string;
  description: string;
  severity: string;
  status: string;
  assignee: string;
  platform: string;
  maturityLevel: string;
  criticality: string;
  phase: string;
  procedureCoverage: string;
  deviceGroup: string;
  deviceCoverage: string;
  falsePositive: string;
  detectionQuery: string;
  observations: string;
  reasonsForFailure: string;
  recommendations: string;
  definedAndWorking: boolean;
  needsImprovement: boolean;
  validateDeviceCov: boolean;
  validateQuerySyntax: boolean;
  checkNewUcRecommend: boolean;
  checkFalsePositives: boolean;
  procedureCovCheck: boolean;
  observationsCheck: boolean;
  failureReasonCheck: boolean;
  recommendCheck: boolean;
  prDetailedAnalysis: boolean;
  startDate: string | null;
  endDate: string | null;
  githubIssueUrl: string;
  githubIssueNumber: number;
  githubReportUrl: string;
  githubProjectUrl: string;
  githubPushedAt: string | null;
  simulations: Simulation[];
  createdAt: string;
  updatedAt: string;
}

const STATUSES = ["To Do", "In Progress", "Done", "Backlog", "L3 Review", "L3 Feedback"];
const SEVERITIES = ["critical", "high", "medium", "low"];
const MATURITY_LEVELS = ["Developing", "Fine-tuned", "Fine-tuning in Progress"];
const PLATFORMS = ["Splunk Enterprise", "Elastic Security", "Microsoft Sentinel", "CrowdStrike", "Custom"];

const STATUS_COLORS: Record<string, string> = {
  "To Do": "bg-muted/10 text-muted", "In Progress": "bg-accent/10 text-accent",
  "Done": "bg-success/10 text-success", "Backlog": "bg-muted/10 text-muted",
  "L3 Review": "bg-warning/10 text-warning", "L3 Feedback": "bg-purple/10 text-purple",
};
const SEV_COLORS: Record<string, string> = {
  critical: "bg-severity-critical/10 text-severity-critical", high: "bg-severity-high/10 text-severity-high",
  medium: "bg-severity-medium/10 text-severity-medium", low: "bg-severity-low/10 text-severity-low",
};

// ── Component ──

export default function ReportingPage() {
  const [tab, setTab] = useState<"knowledge" | "metrics" | "debt" | "reports">("reports");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [formSims, setFormSims] = useState<Simulation[]>([{ description: "", output: "", order: 0 }]);

  // GitHub push state
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [ghOwner, setGhOwner] = useState("");
  const [ghRepo, setGhRepo] = useState("detection-reports");
  const [ghCreateProject, setGhCreateProject] = useState(false);
  const [pushResult, setPushResult] = useState<{ success: boolean; message: string; urls?: Record<string, string> } | null>(null);

  // Search/filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sevFilter, setSevFilter] = useState("");

  function emptyForm(): Omit<Report, "id" | "simulations" | "createdAt" | "updatedAt" | "githubIssueUrl" | "githubIssueNumber" | "githubReportUrl" | "githubProjectUrl" | "githubPushedAt"> {
    return {
      name: "", description: "", severity: "medium", status: "To Do", assignee: "",
      platform: "Splunk Enterprise", maturityLevel: "Developing", criticality: "", phase: "",
      procedureCoverage: "Full Procedure Covered", deviceGroup: "Cover All Devices",
      deviceCoverage: "Cover All Devices", falsePositive: "No", detectionQuery: "",
      observations: "", reasonsForFailure: "", recommendations: "",
      definedAndWorking: false, needsImprovement: false, validateDeviceCov: false,
      validateQuerySyntax: false, checkNewUcRecommend: false, checkFalsePositives: false,
      procedureCovCheck: false, observationsCheck: false, failureReasonCheck: false,
      recommendCheck: false, prDetailedAnalysis: false, startDate: null, endDate: null,
    };
  }

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page_size: "50" });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (sevFilter) params.set("severity", sevFilter);
      const res = await fetch(`/api/reports?${params}`);
      if (res.ok) { const d = await res.json(); setReports(d.items); setTotal(d.total); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [search, statusFilter, sevFilter]);

  useEffect(() => { if (tab === "reports") fetchReports(); }, [tab, fetchReports]);

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/reports/${editingId}` : "/api/reports";
      const method = editingId ? "PUT" : "POST";
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, simulations: formSims }),
      });
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      setFormSims([{ description: "", output: "", order: 0 }]);
      fetchReports();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleEdit = (r: Report) => {
    setForm({ ...r });
    setFormSims(r.simulations.length > 0 ? r.simulations : [{ description: "", output: "", order: 0 }]);
    setEditingId(r.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    fetchReports();
  };

  const handleGitHubPush = async (id: string) => {
    if (!ghOwner) return;
    setPushingId(id);
    setPushResult(null);
    try {
      const res = await fetch(`/api/reports/${id}/github-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: ghOwner, repoName: ghRepo, createProject: ghCreateProject }),
      });
      const data = await res.json();
      setPushResult({
        success: data.success,
        message: data.success ? "Report pushed to GitHub" : (data.error || "Push failed"),
        urls: data.success ? { report: data.reportUrl, issue: data.issueUrl, repo: data.repoUrl, project: data.projectUrl } : undefined,
      });
      if (data.success) fetchReports();
    } catch (err) {
      setPushResult({ success: false, message: err instanceof Error ? err.message : "Push failed" });
    } finally { setPushingId(null); }
  };

  const doneCount = reports.filter((r) => r.status === "Done").length;
  const pushedCount = reports.filter((r) => r.githubPushedAt).length;
  const inProgressCount = reports.filter((r) => r.status === "In Progress").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reporting & Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Detection use case reports, coverage metrics, and GitHub-integrated CI/CD reporting
          </p>
        </div>
        {tab === "reports" && (
          <button
            onClick={() => { setForm(emptyForm()); setFormSims([{ description: "", output: "", order: 0 }]); setEditingId(null); setShowForm(true); }}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> New Report
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "reports", label: "Use Case Reports" },
          { key: "knowledge", label: "Knowledge Base" },
          { key: "metrics", label: "Metrics & Trends" },
          { key: "debt", label: "Detection Debt" },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t.key ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ Use Case Reports Tab ═══ */}
      {tab === "reports" && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Total Reports" value={String(total)} color="text-foreground" />
            <StatCard label="In Progress" value={String(inProgressCount)} color="text-accent" />
            <StatCard label="Completed" value={String(doneCount)} color="text-success" />
            <StatCard label="Pushed to GitHub" value={String(pushedCount)} color="text-purple" />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input type="text" placeholder="Search reports…" value={search} onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={sevFilter} onChange={(e) => setSevFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
              <option value="">All Severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </div>

          {/* Push result banner */}
          {pushResult && (
            <div className={cn("flex items-center justify-between rounded-lg border px-4 py-2.5",
              pushResult.success ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
            )}>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {pushResult.success ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <XCircle className="h-4 w-4 text-danger shrink-0" />}
                <span className="text-xs text-foreground font-medium">{pushResult.message}</span>
                {pushResult.urls && (
                  <div className="flex items-center gap-3 ml-2">
                    {pushResult.urls.report && <a href={pushResult.urls.report} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline flex items-center gap-0.5"><ExternalLink className="h-2.5 w-2.5" /> Report</a>}
                    {pushResult.urls.issue && <a href={pushResult.urls.issue} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline flex items-center gap-0.5"><ExternalLink className="h-2.5 w-2.5" /> Issue</a>}
                  </div>
                )}
              </div>
              <button onClick={() => setPushResult(null)} className="text-muted hover:text-foreground"><X className="h-3 w-3" /></button>
            </div>
          )}

          {/* Report List */}
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-center">
              <FileText className="h-10 w-10 text-muted mb-3" />
              <h3 className="text-lg font-semibold text-foreground">No Reports Yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">Create your first detection use case report. Reports can be pushed to GitHub as structured markdown with automated issue tracking.</p>
              <button onClick={() => { setForm(emptyForm()); setShowForm(true); }} className="mt-4 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
                <Plus className="h-4 w-4" /> Create Report
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {reports.map((r) => {
                const isExpanded = expandedId === r.id;
                return (
                  <div key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    {/* Row */}
                    <button onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card-hover transition-colors text-left">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold capitalize", SEV_COLORS[r.severity] || "bg-muted/10 text-muted")}>{r.severity}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold", STATUS_COLORS[r.status] || "bg-muted/10 text-muted")}>{r.status}</span>
                          {r.githubPushedAt && <span className="flex items-center gap-0.5 text-[9px] text-purple font-medium"><GitBranch className="h-2.5 w-2.5" /> GitHub</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                          {r.assignee && <span>{r.assignee}</span>}
                          {r.platform && <span>{r.platform}</span>}
                          <span>{new Date(r.updatedAt).toLocaleDateString()}</span>
                          {r.simulations.length > 0 && <span>{r.simulations.length} simulation{r.simulations.length !== 1 ? "s" : ""}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); handleEdit(r); }} className="rounded p-1.5 hover:bg-accent/10 text-muted hover:text-accent transition-colors" title="Edit">
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setPushingId(r.id === pushingId ? null : r.id); setPushResult(null); }}
                          className="rounded p-1.5 hover:bg-purple/10 text-muted hover:text-purple transition-colors" title="Push to GitHub">
                          <GitBranch className="h-3 w-3" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }} className="rounded p-1.5 hover:bg-danger/10 text-muted hover:text-danger transition-colors" title="Delete">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </button>

                    {/* GitHub push inline */}
                    {pushingId === r.id && (
                      <div className="border-t border-border bg-purple/5 px-4 py-3 space-y-2">
                        <p className="text-[10px] font-semibold text-purple uppercase flex items-center gap-1.5"><GitBranch className="h-3 w-3" /> Push to GitHub</p>
                        <div className="flex items-center gap-2">
                          <input type="text" value={ghOwner} onChange={(e) => setGhOwner(e.target.value)} placeholder="GitHub username or org *"
                            className="h-8 flex-1 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
                          <input type="text" value={ghRepo} onChange={(e) => setGhRepo(e.target.value)} placeholder="Repository name"
                            className="h-8 w-48 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
                            <input type="checkbox" checked={ghCreateProject} onChange={(e) => setGhCreateProject(e.target.checked)} className="h-3 w-3" />
                            Create Project
                          </label>
                          <button onClick={() => handleGitHubPush(r.id)} disabled={!ghOwner || saving}
                            className="flex items-center gap-1.5 rounded-lg bg-purple px-3 py-1.5 text-[10px] font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50 whitespace-nowrap">
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />} Push
                          </button>
                        </div>
                        {r.githubReportUrl && (
                          <div className="flex items-center gap-3 text-[10px]">
                            <a href={r.githubReportUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-0.5"><ExternalLink className="h-2.5 w-2.5" /> Report</a>
                            {r.githubIssueUrl && <a href={r.githubIssueUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-0.5"><ExternalLink className="h-2.5 w-2.5" /> Issue #{r.githubIssueNumber}</a>}
                            {r.githubProjectUrl && <a href={r.githubProjectUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-0.5"><ExternalLink className="h-2.5 w-2.5" /> Project</a>}
                            <span className="text-muted">Pushed: {new Date(r.githubPushedAt!).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-border bg-background px-4 py-4 space-y-4">
                        {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}

                        <div className="grid grid-cols-4 gap-3 text-xs">
                          {[
                            ["Platform", r.platform], ["Maturity", r.maturityLevel], ["Phase", r.phase],
                            ["Criticality", r.criticality || r.severity], ["Procedure", r.procedureCoverage],
                            ["Device Group", r.deviceGroup], ["Device Coverage", r.deviceCoverage],
                            ["False Positive", r.falsePositive], ["Defined & Working", r.definedAndWorking ? "Yes" : "No"],
                            ["Needs Improvement", r.needsImprovement ? "Yes" : "No"],
                            ["Start", r.startDate ? new Date(r.startDate).toLocaleDateString() : "—"],
                            ["End", r.endDate ? new Date(r.endDate).toLocaleDateString() : "—"],
                          ].map(([label, value]) => (
                            <div key={label as string}><p className="text-[9px] text-muted uppercase font-semibold">{label}</p><p className="text-foreground">{value || "—"}</p></div>
                          ))}
                        </div>

                        {r.detectionQuery && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1">Detection Query</p>
                            <pre className="rounded-lg border border-border bg-[#0d1117] p-3 text-[10px] text-green-400 font-mono whitespace-pre-wrap max-h-[150px] overflow-auto">{r.detectionQuery}</pre>
                          </div>
                        )}

                        {r.simulations.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1">Simulations ({r.simulations.length})</p>
                            {r.simulations.map((s, i) => (
                              <div key={i} className="rounded-lg border border-border bg-card p-3 mb-1.5">
                                <p className="text-[10px] text-accent font-semibold">Simulation {i + 1}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{s.description || "No description"}</p>
                                {s.output && <pre className="mt-1 rounded bg-background p-2 text-[9px] text-muted-foreground font-mono whitespace-pre-wrap max-h-[100px] overflow-auto">{s.output}</pre>}
                              </div>
                            ))}
                          </div>
                        )}

                        {(r.observations || r.reasonsForFailure || r.recommendations) && (
                          <div className="grid grid-cols-3 gap-3">
                            {r.observations && <div><p className="text-[10px] font-semibold text-muted uppercase mb-1">Observations</p><p className="text-xs text-muted-foreground">{r.observations}</p></div>}
                            {r.reasonsForFailure && <div><p className="text-[10px] font-semibold text-muted uppercase mb-1">Reason for Failure</p><p className="text-xs text-muted-foreground">{r.reasonsForFailure}</p></div>}
                            {r.recommendations && <div><p className="text-[10px] font-semibold text-muted uppercase mb-1">Recommendations</p><p className="text-xs text-muted-foreground">{r.recommendations}</p></div>}
                          </div>
                        )}

                        {/* Checklist */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1">Requirements</p>
                            {[
                              [r.validateDeviceCov, "Validate Device Coverage"],
                              [r.validateQuerySyntax, "Validate Query Syntax"],
                              [r.checkNewUcRecommend, "Check for New UC Recommendation"],
                              [r.checkFalsePositives, "Check for False Positives"],
                              [r.procedureCovCheck, "Procedure Coverage"],
                            ].map(([checked, label]) => (
                              <div key={label as string} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                {checked ? <CheckCircle className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-muted/30" />} {label as string}
                              </div>
                            ))}
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold text-muted uppercase mb-1">Deliverables</p>
                            {[
                              [r.observationsCheck, "Observations"],
                              [r.failureReasonCheck, "Reason for Failures"],
                              [r.recommendCheck, "Recommendation Details"],
                              [r.prDetailedAnalysis, "PR for Detailed Analysis"],
                            ].map(([checked, label]) => (
                              <div key={label as string} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                {checked ? <CheckCircle className="h-3 w-3 text-success" /> : <XCircle className="h-3 w-3 text-muted/30" />} {label as string}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Report Form Modal ═══ */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-12 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-lg m-4">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">{editingId ? "Edit Report" : "New Detection Report"}</h2>
              <button onClick={() => setShowForm(false)} className="text-muted hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Use Case Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. propagation_with_same_filename" />
                <FormField label="Assignee" value={form.assignee} onChange={(v) => setForm({ ...form, assignee: v })} placeholder="Assignee name" />
                <FormSelect label="Severity" value={form.severity} onChange={(v) => setForm({ ...form, severity: v })} options={SEVERITIES} />
                <FormSelect label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={STATUSES} />
                <FormSelect label="Platform" value={form.platform} onChange={(v) => setForm({ ...form, platform: v })} options={PLATFORMS} />
                <FormSelect label="Maturity Level" value={form.maturityLevel} onChange={(v) => setForm({ ...form, maturityLevel: v })} options={MATURITY_LEVELS} />
                <FormField label="Phase" value={form.phase} onChange={(v) => setForm({ ...form, phase: v })} placeholder="e.g. Phase 3 - 1" />
                <FormField label="Criticality" value={form.criticality} onChange={(v) => setForm({ ...form, criticality: v })} placeholder="Same as severity or custom" />
                <FormField label="Start Date" value={form.startDate || ""} onChange={(v) => setForm({ ...form, startDate: v })} type="date" />
                <FormField label="End Date" value={form.endDate || ""} onChange={(v) => setForm({ ...form, endDate: v })} type="date" />
              </div>

              <FormTextarea label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Use case description" rows={2} />
              <FormTextarea label="Detection Query (SPL)" value={form.detectionQuery} onChange={(v) => setForm({ ...form, detectionQuery: v })} placeholder="| tstats ..." rows={4} mono />

              {/* Coverage */}
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Procedure Coverage" value={form.procedureCoverage} onChange={(v) => setForm({ ...form, procedureCoverage: v })} placeholder="Full Procedure Covered" />
                <FormField label="Device Group" value={form.deviceGroup} onChange={(v) => setForm({ ...form, deviceGroup: v })} placeholder="Cover All Devices" />
                <FormSelect label="False Positive" value={form.falsePositive} onChange={(v) => setForm({ ...form, falsePositive: v })} options={["No", "Yes", "Unknown"]} />
              </div>

              {/* Simulations */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-muted uppercase">Simulations</p>
                  <button onClick={() => setFormSims([...formSims, { description: "", output: "", order: formSims.length }])}
                    className="flex items-center gap-1 text-[10px] text-accent hover:text-accent/80"><Plus className="h-3 w-3" /> Add Simulation</button>
                </div>
                {formSims.map((s, i) => (
                  <div key={i} className="rounded-lg border border-border bg-background p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-accent font-semibold">Simulation {i + 1}</p>
                      {formSims.length > 1 && <button onClick={() => setFormSims(formSims.filter((_, j) => j !== i))} className="text-danger/50 hover:text-danger"><X className="h-3 w-3" /></button>}
                    </div>
                    <FormField label="Description" value={s.description} onChange={(v) => { const u = [...formSims]; u[i] = { ...u[i], description: v }; setFormSims(u); }} placeholder="Technique and method simulated" />
                    <FormTextarea label="Output" value={s.output} onChange={(v) => { const u = [...formSims]; u[i] = { ...u[i], output: v }; setFormSims(u); }} placeholder="Simulation output" rows={2} mono />
                  </div>
                ))}
              </div>

              {/* Analysis */}
              <FormTextarea label="Observations" value={form.observations} onChange={(v) => setForm({ ...form, observations: v })} placeholder="How many techniques simulated / detected" rows={2} />
              <FormTextarea label="Reason for Failure" value={form.reasonsForFailure} onChange={(v) => setForm({ ...form, reasonsForFailure: v })} placeholder="Why detection failed" rows={2} />
              <FormTextarea label="Recommendations" value={form.recommendations} onChange={(v) => setForm({ ...form, recommendations: v })} placeholder="Improvements to detection posture" rows={2} />

              {/* Checklist toggles */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted uppercase">Requirements</p>
                  {[
                    ["validateDeviceCov", "Validate Device Coverage"], ["validateQuerySyntax", "Validate Query Syntax"],
                    ["checkNewUcRecommend", "Check New UC Recommendation"], ["checkFalsePositives", "Check False Positives"],
                    ["procedureCovCheck", "Procedure Coverage"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                      <input type="checkbox" checked={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} className="h-3 w-3 rounded" /> {label}
                    </label>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted uppercase">Deliverables</p>
                  {[
                    ["observationsCheck", "Observations"], ["failureReasonCheck", "Reason for Failures"],
                    ["recommendCheck", "Recommendation Details"], ["prDetailedAnalysis", "PR for Detailed Analysis"],
                    ["definedAndWorking", "Defined & Working"], ["needsImprovement", "Needs Improvement"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer">
                      <input type="checkbox" checked={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} className="h-3 w-3 rounded" /> {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                {editingId ? "Update Report" : "Create Report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Other tabs (unchanged) ═══ */}
      {tab === "knowledge" && (
        <div className="rounded-xl border border-border bg-card p-8">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted mb-3" />
            <p className="text-sm text-muted-foreground">No LOCK documents yet. Create a LOCK document to track detection engineering knowledge.</p>
          </div>
        </div>
      )}
      {tab === "metrics" && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "MTTD (current)", value: "\u2014", icon: Clock, color: "text-muted" },
              { label: "MTTI (current)", value: "\u2014", icon: TrendingDown, color: "text-muted" },
              { label: "ATT&CK Coverage", value: "\u2014", icon: Shield, color: "text-muted" },
              { label: "Avg Reliability", value: "\u2014", icon: CheckCircle, color: "text-muted" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-4">
                <m.icon className={cn("h-5 w-5", m.color)} />
                <p className="mt-2 text-2xl font-bold text-foreground">{m.value}</p>
                <p className="text-xs text-muted">{m.label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card p-8">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <BarChart3 className="h-10 w-10 text-muted mb-3" />
              <p className="text-sm text-muted-foreground">Metrics will populate once detection validation pipelines are running.</p>
            </div>
          </div>
        </div>
      )}
      {tab === "debt" && (
        <div className="rounded-xl border border-border bg-card p-8">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-muted mb-3" />
            <p className="text-sm text-muted-foreground">No detection debt items tracked yet.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] font-semibold text-muted uppercase">{label}</p>
      <p className={cn("text-xl font-bold mt-1", color)}>{value}</p>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted uppercase">{label}</label>
      <input type={type || "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
    </div>
  );
}

function FormSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted uppercase">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-lg border border-border bg-input px-2.5 text-xs text-foreground focus:border-input-focus focus:outline-none capitalize">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FormTextarea({ label, value, onChange, placeholder, rows, mono }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold text-muted uppercase">{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows || 3}
        className={cn("w-full rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none resize-y", mono && "font-mono bg-[#0d1117] text-green-400 placeholder:text-gray-600")} />
    </div>
  );
}
