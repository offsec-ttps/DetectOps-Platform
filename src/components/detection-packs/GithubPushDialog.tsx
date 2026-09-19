"use client";

import { useEffect, useState } from "react";
import {
  GitPullRequest, X, Loader2, AlertTriangle, CheckCircle2, ExternalLink, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  packId: string;
  status: string;
  existingIssueUrl: string | null;
  existingIssueNumber: number | null;
  onPushed: (issueUrl: string, issueNumber: number) => void;
}

const DEFAULT_LABELS_BY_STATUS: Record<string, string[]> = {
  draft:      ["detection-pack", "status:draft"],
  test:       ["detection-pack", "status:test"],
  tune:       ["detection-pack", "status:tune"],
  validate:   ["detection-pack", "status:validate"],
  production: ["detection-pack", "status:production"],
  deprecated: ["detection-pack", "status:deprecated"],
};

export default function GithubPushDialog({
  open, onClose, packId, status, existingIssueUrl, existingIssueNumber, onPushed,
}: Props) {
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [updateIfExists, setUpdateIfExists] = useState(true);
  const [labelsRaw, setLabelsRaw] = useState((DEFAULT_LABELS_BY_STATUS[status] || ["detection-pack"]).join(", "));
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<{ action: "created" | "commented"; issueUrl: string; issueNumber: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // Reset on open and re-seed labels for current status
      setResult(null); setError(null); setPushing(false);
      setLabelsRaw((DEFAULT_LABELS_BY_STATUS[status] || ["detection-pack"]).join(", "));
    }
  }, [open, status]);

  if (!open) return null;

  const push = async () => {
    setPushing(true); setError(null); setResult(null);
    try {
      const labels = labelsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/detection-packs/${packId}/github-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repo.trim(),
          token: token.trim() || undefined,
          labels,
          updateIfExists,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.code === "missing_token"
          ? "GitHub token required. Either paste one in the form or set GITHUB_TOKEN in .env."
          : data.error || "Push failed");
        return;
      }
      setResult(data);
      onPushed(data.issueUrl, data.issueNumber);
    } catch (err: any) {
      setError(err?.message || "Push failed");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            {existingIssueUrl ? `Update issue #${existingIssueNumber}` : "Push to GitHub"}
          </h2>
          <button onClick={onClose} className="ml-auto p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </div>

        <div className="p-5 space-y-3">
          {existingIssueUrl && (
            <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-info">
              This pack already has an issue: <a href={existingIssueUrl} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">#{existingIssueNumber} <ExternalLink className="h-3 w-3" /></a>.
              By default we'll <strong>add an update comment</strong> rather than creating a new one.
            </div>
          )}

          <Field label="Repo (owner/repo)" required>
            <input
              type="text" value={repo} onChange={(e) => setRepo(e.target.value)}
              placeholder="my-org/detection-content"
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono"
            />
          </Field>

          <Field label="Personal access token (optional)">
            <div className="relative">
              <KeyRound className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                type="password" value={token} onChange={(e) => setToken(e.target.value)}
                placeholder="leave blank to use GITHUB_TOKEN from .env"
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono"
              />
            </div>
          </Field>

          <Field label="Labels (comma-separated)">
            <input
              type="text" value={labelsRaw} onChange={(e) => setLabelsRaw(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent"
            />
          </Field>

          {existingIssueUrl && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer">
              <input
                type="checkbox" checked={updateIfExists} onChange={(e) => setUpdateIfExists(e.target.checked)}
                className="accent-accent"
              />
              Update existing issue with a comment (uncheck to create a new issue instead)
            </label>
          )}

          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger inline-flex items-start gap-2 w-full">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}
          {result && (
            <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11px] text-success">
              <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
              {result.action === "created" ? "Created" : "Commented on"} issue{" "}
              <a href={result.issueUrl} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5">
                #{result.issueNumber} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground hover:text-foreground">
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={push}
              disabled={pushing || !repo.trim()}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded text-white",
                "bg-gradient-to-r from-foreground/80 to-foreground hover:opacity-90 disabled:opacity-50",
              )}
            >
              {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitPullRequest className="h-3 w-3" />}
              {existingIssueUrl && updateIfExists ? "Add update comment" : "Create issue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
