"use client";

import { useState } from "react";
import {
  GitPullRequest, Loader2, X, AlertTriangle, CheckCircle2, ExternalLink, Tag,
} from "lucide-react";

interface Props {
  packId: string;
  runId: string;
  defaultRepo?: string;
  hasExistingIssue?: boolean;
  onClose: () => void;
  onPushed: (result: { action: "created" | "commented"; issueUrl: string; issueNumber: number }) => void;
}

export default function GithubPushDialog({ packId, runId, defaultRepo, hasExistingIssue, onClose, onPushed }: Props) {
  const [repo, setRepo] = useState(defaultRepo || "");
  const [token, setToken] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [updateIfExists, setUpdateIfExists] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ action: "created" | "commented"; issueUrl: string; issueNumber: number } | null>(null);

  const push = async () => {
    setError(null); setPushing(true);
    try {
      const labels = labelsText.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/enterprise-use-cases/${packId}/runs/${runId}/github-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, token: token || undefined, labels: labels.length ? labels : undefined, updateIfExists }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "push failed"); return; }
      setDone(data);
      onPushed(data);
    } catch (err: any) {
      setError(err?.message || "push failed");
    } finally { setPushing(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-y-auto">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Push to GitHub Issue</h2>
          <button onClick={onClose} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 border-b border-danger/30 bg-danger/10 text-xs text-danger inline-flex items-center gap-2 w-full">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        )}

        {done ? (
          <div className="p-5 space-y-3">
            <div className="rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success inline-flex items-center gap-2 w-full">
              <CheckCircle2 className="h-4 w-4" />
              {done.action === "created" ? `Created issue #${done.issueNumber}` : `Commented on issue #${done.issueNumber}`}
            </div>
            <a href={done.issueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              {done.issueUrl} <ExternalLink className="h-3 w-3" />
            </a>
            <div className="flex justify-end">
              <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground hover:text-foreground">Close</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3">
              <Field label="Repository (owner/repo)" required>
                <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)}
                  placeholder="my-org/detection-content"
                  className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              </Field>
              <Field label="GitHub token (PAT)">
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder="Leave blank to use GITHUB_TOKEN env"
                  className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sent server-side; never persisted. Requires <span className="font-mono">repo</span> scope.
                </p>
              </Field>
              <Field label="Labels (comma-separated)">
                <input type="text" value={labelsText} onChange={(e) => setLabelsText(e.target.value)}
                  placeholder="e.g. enterprise-uc, status:validated, severity:critical"
                  className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                <p className="text-[10px] text-muted-foreground mt-1 inline-flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Blank = default `["enterprise-uc", "status:&lt;current&gt;"]`.
                </p>
              </Field>
              {hasExistingIssue && (
                <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={updateIfExists} onChange={(e) => setUpdateIfExists(e.target.checked)} className="accent-accent" />
                  Comment on existing issue instead of creating a new one
                </label>
              )}
            </div>

            <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
              <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button onClick={push} disabled={pushing || !repo.trim()} className="inline-flex items-center gap-1.5 text-xs h-8 px-4 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
                {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitPullRequest className="h-3 w-3" />}
                {pushing ? "Pushing…" : "Push to GitHub"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block font-semibold">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
