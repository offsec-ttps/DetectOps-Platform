"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  GitPullRequest, RefreshCw, ExternalLink, Filter, Loader2,
  CheckCircle2, XCircle, Clock, GitMerge, MessageSquare,
  ChevronRight, ChevronDown, AlertTriangle, Eye, X, Check,
  GitBranch, Shield,
} from "lucide-react";

interface PRLabel {
  name: string;
  color: string;
}

interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  url: string;
  branch: string;
  baseBranch: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  labels: PRLabel[];
  reviewCount: number;
  approved: boolean;
  changesRequested: boolean;
  latestReviewState: string | null;
  latestReviewUser: string | null;
  latestReviewBody: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
}

const STATE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  open_needs_review: { label: "Needs Review", color: "text-warning bg-warning/10 border-warning/30", icon: Eye },
  open_approved: { label: "Approved", color: "text-success bg-success/10 border-success/30", icon: CheckCircle2 },
  open_changes_requested: { label: "Changes Requested", color: "text-danger bg-danger/10 border-danger/30", icon: AlertTriangle },
  open_draft: { label: "Draft", color: "text-muted bg-muted/10 border-border", icon: GitPullRequest },
  open: { label: "Open", color: "text-accent bg-accent/10 border-accent/30", icon: GitPullRequest },
  merged: { label: "Merged", color: "text-purple bg-purple/10 border-purple/30", icon: GitMerge },
  closed: { label: "Closed", color: "text-danger bg-danger/10 border-danger/30", icon: XCircle },
};

function getPRState(pr: PullRequest): string {
  if (pr.merged) return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "open_draft";
  if (pr.approved) return "open_approved";
  if (pr.changesRequested) return "open_changes_requested";
  if (pr.reviewCount === 0) return "open_needs_review";
  return "open";
}

export default function PRManagementPage() {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedPr, setExpandedPr] = useState<number | null>(null);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("detection-reports");
  const [ownerInput, setOwnerInput] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionResult, setActionResult] = useState<{ pr: number; success: boolean; message: string } | null>(null);
  const [reviewComment, setReviewComment] = useState("");

  const fetchPRs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ repo, state: "all" });
      if (owner) params.set("owner", owner);
      const res = await fetch(`/api/github/prs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPrs(data.items || []);
        if (data.owner && !owner) { setOwner(data.owner); setOwnerInput(data.owner); }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [owner, repo]);

  useEffect(() => { fetchPRs(); }, [fetchPRs]);

  const handleAction = async (prNumber: number, action: string) => {
    setActionLoading(prNumber);
    setActionResult(null);
    try {
      const res = await fetch("/api/github/prs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, prNumber, action, reviewComment }),
      });
      const data = await res.json();
      setActionResult({ pr: prNumber, success: data.merged || data.success || false, message: data.message || (action === "merge" ? (data.merged ? "PR merged" : "Merge failed") : "Done") });
      setReviewComment("");
      fetchPRs();
    } catch (err) {
      setActionResult({ pr: prNumber, success: false, message: err instanceof Error ? err.message : "Action failed" });
    } finally { setActionLoading(null); }
  };

  const filteredPRs = filterStatus === "all" ? prs : prs.filter((pr) => {
    const state = getPRState(pr);
    if (filterStatus === "open") return pr.state === "open";
    if (filterStatus === "merged") return pr.merged;
    if (filterStatus === "closed") return pr.state === "closed" && !pr.merged;
    if (filterStatus === "needs_review") return state === "open_needs_review";
    if (filterStatus === "approved") return state === "open_approved";
    if (filterStatus === "changes_requested") return state === "open_changes_requested";
    if (filterStatus === "draft") return pr.draft;
    return true;
  });

  const openCount = prs.filter((p) => p.state === "open").length;
  const needsReviewCount = prs.filter((p) => getPRState(p) === "open_needs_review").length;
  const approvedCount = prs.filter((p) => p.approved && p.state === "open").length;
  const mergedCount = prs.filter((p) => p.merged).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">PR Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review, approve, and merge detection report PRs — human-in-the-loop review workflow
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="text" value={ownerInput} onChange={(e) => setOwnerInput(e.target.value)} onBlur={() => setOwner(ownerInput)} placeholder="GitHub owner"
            className="h-8 w-32 rounded-lg border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
          <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo"
            className="h-8 w-36 rounded-lg border border-border bg-input px-2 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
          <button onClick={fetchPRs} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Sync
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "Open PRs", value: String(openCount), color: "text-accent" },
          { label: "Needs Review", value: String(needsReviewCount), color: "text-warning" },
          { label: "Approved", value: String(approvedCount), color: "text-success" },
          { label: "Merged", value: String(mergedCount), color: "text-purple" },
          { label: "Total", value: String(prs.length), color: "text-foreground" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-semibold text-muted uppercase">{s.label}</p>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted" />
        {["all", "open", "needs_review", "approved", "changes_requested", "draft", "merged", "closed"].map((status) => (
          <button key={status} onClick={() => setFilterStatus(status)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filterStatus === status ? "bg-accent text-white" : "bg-card border border-border text-muted-foreground hover:text-foreground"
            )}>
            {status === "all" ? "All" : status === "needs_review" ? "Needs Review" : status === "changes_requested" ? "Changes Requested" : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Action result banner */}
      {actionResult && (
        <div className={cn("flex items-center justify-between rounded-lg border px-4 py-2.5",
          actionResult.success ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
        )}>
          <div className="flex items-center gap-2">
            {actionResult.success ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />}
            <span className="text-xs font-medium text-foreground">PR #{actionResult.pr}:</span>
            <span className="text-xs text-muted-foreground">{actionResult.message}</span>
          </div>
          <button onClick={() => setActionResult(null)} className="text-muted hover:text-foreground"><X className="h-3 w-3" /></button>
        </div>
      )}

      {/* PR List */}
      {loading && prs.length === 0 ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : prs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <GitPullRequest className="h-10 w-10 text-muted mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground">No Pull Requests</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {owner ? `No PRs found in ${owner}/${repo}. Push a detection report from Campaign Designer or Reporting to create one.` : "Configure your GitHub owner and repository above, then click Sync."}
          </p>
        </div>
      ) : filteredPRs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No PRs match the selected filter.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPRs.map((pr) => {
            const prState = getPRState(pr);
            const stateConfig = STATE_CONFIG[prState] || STATE_CONFIG.open;
            const StateIcon = stateConfig.icon;
            const isExpanded = expandedPr === pr.number;

            return (
              <div key={pr.number} className={cn("rounded-xl border bg-card overflow-hidden transition-all",
                prState === "open_needs_review" ? "border-warning/20" :
                prState === "open_approved" ? "border-success/20" :
                prState === "merged" ? "border-purple/20" :
                prState === "open_changes_requested" ? "border-danger/20" : "border-border"
              )}>
                {/* PR Row */}
                <button onClick={() => setExpandedPr(isExpanded ? null : pr.number)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card-hover transition-colors text-left">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted shrink-0" />}
                  <StateIcon className={cn("h-4 w-4 shrink-0", stateConfig.color.split(" ")[0])} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{pr.title}</p>
                      <span className="text-[10px] text-muted font-mono">#{pr.number}</span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-semibold", stateConfig.color)}>
                        {stateConfig.label}
                      </span>
                      {pr.labels.map((l) => (
                        <span key={l.name} className="rounded-full bg-muted/10 px-2 py-0.5 text-[9px] text-muted-foreground">{l.name}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                      <span>{pr.author}</span>
                      <span className="flex items-center gap-0.5"><GitBranch className="h-2.5 w-2.5" /> {pr.branch} → {pr.baseBranch}</span>
                      <span>{timeAgo(pr.updatedAt)}</span>
                      {pr.reviewCount > 0 && <span className="flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" /> {pr.reviewCount} review{pr.reviewCount !== 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                  <a href={pr.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                    className="shrink-0 rounded p-1.5 hover:bg-accent/10 text-muted hover:text-accent transition-colors" title="Open in GitHub">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border bg-background px-4 py-4 space-y-4">
                    {/* PR body */}
                    {pr.body && (
                      <div className="rounded-lg border border-border bg-card p-3">
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed max-h-[250px] overflow-auto">{pr.body}</pre>
                      </div>
                    )}

                    {/* Review status */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="text-[10px] font-semibold text-muted uppercase mb-1">Review Status</p>
                        <div className="flex items-center gap-2">
                          {pr.approved ? (
                            <span className="flex items-center gap-1 text-xs text-success font-medium"><CheckCircle2 className="h-3.5 w-3.5" /> Approved</span>
                          ) : pr.changesRequested ? (
                            <span className="flex items-center gap-1 text-xs text-danger font-medium"><AlertTriangle className="h-3.5 w-3.5" /> Changes Requested</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-warning font-medium"><Clock className="h-3.5 w-3.5" /> Awaiting Review</span>
                          )}
                        </div>
                        {pr.latestReviewUser && (
                          <p className="text-[10px] text-muted mt-1">Last reviewed by {pr.latestReviewUser}</p>
                        )}
                        {pr.latestReviewBody && (
                          <p className="text-[10px] text-muted-foreground mt-1 italic">&ldquo;{pr.latestReviewBody}&rdquo;</p>
                        )}
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="text-[10px] font-semibold text-muted uppercase mb-1">Changes</p>
                        <div className="flex items-center gap-3 text-xs">
                          {pr.additions > 0 && <span className="text-success font-mono">+{pr.additions}</span>}
                          {pr.deletions > 0 && <span className="text-danger font-mono">-{pr.deletions}</span>}
                          <span className="text-muted">{pr.changedFiles || "?"} file{pr.changedFiles !== 1 ? "s" : ""}</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <p className="text-[10px] font-semibold text-muted uppercase mb-1">Timeline</p>
                        <div className="text-[10px] text-muted-foreground space-y-0.5">
                          <p>Created: {new Date(pr.createdAt).toLocaleString()}</p>
                          <p>Updated: {new Date(pr.updatedAt).toLocaleString()}</p>
                          {pr.mergedAt && <p className="text-purple font-medium">Merged: {new Date(pr.mergedAt).toLocaleString()}</p>}
                          {pr.closedAt && !pr.merged && <p className="text-danger font-medium">Closed: {new Date(pr.closedAt).toLocaleString()}</p>}
                        </div>
                      </div>
                    </div>

                    {/* Actions — only for open PRs */}
                    {pr.state === "open" && (
                      <div className="space-y-3">
                        <p className="text-[10px] font-semibold text-muted uppercase">Actions</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Approve */}
                          {!pr.approved && (
                            <button onClick={() => handleAction(pr.number, "approve")} disabled={actionLoading === pr.number}
                              className="flex items-center gap-1.5 rounded-lg bg-success/90 px-4 py-2 text-xs font-medium text-white hover:bg-success transition-colors disabled:opacity-50">
                              {actionLoading === pr.number ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Approve
                            </button>
                          )}
                          {pr.approved && <span className="flex items-center gap-1 text-xs text-success font-medium"><CheckCircle2 className="h-3 w-3" /> Approved</span>}

                          {/* Merge */}
                          <button onClick={() => handleAction(pr.number, "merge")} disabled={actionLoading === pr.number}
                            className="flex items-center gap-1.5 rounded-lg bg-purple px-4 py-2 text-xs font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50">
                            {actionLoading === pr.number ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
                            Squash & Merge
                          </button>

                          {/* Request changes */}
                          <button onClick={() => handleAction(pr.number, "request_changes")} disabled={actionLoading === pr.number || !reviewComment}
                            className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-3 py-2 text-xs font-medium text-danger hover:bg-danger/5 transition-colors disabled:opacity-50">
                            <AlertTriangle className="h-3 w-3" /> Request Changes
                          </button>

                          <a href={pr.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                            <ExternalLink className="h-3 w-3" /> View on GitHub
                          </a>
                        </div>

                        {/* Review comment input */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-muted uppercase">Review Comment (required for "Request Changes")</label>
                          <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="Add a review comment…"
                            rows={2}
                            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none resize-y" />
                        </div>
                      </div>
                    )}

                    {/* Merged badge */}
                    {pr.merged && (
                      <div className="rounded-lg border border-purple/20 bg-purple/5 px-4 py-3 flex items-center gap-2">
                        <GitMerge className="h-4 w-4 text-purple" />
                        <div>
                          <p className="text-xs font-semibold text-purple">Merged</p>
                          <p className="text-[10px] text-muted-foreground">This PR was merged into {pr.baseBranch} on {new Date(pr.mergedAt!).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
