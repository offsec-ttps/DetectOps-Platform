"use client";

import { useEffect, useState } from "react";
import {
  FileText, Download, GitPullRequest, Loader2, RefreshCw, Activity, ExternalLink, Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CoverageBadge, { type CoverageOutcome } from "./CoverageBadge";
import GithubPushDialog from "./GithubPushDialog";
import CommentThread from "./CommentThread";

interface Run {
  id: string;
  environmentName?: string | null;
  environmentKind?: string | null;
  mode: string;
  status: string;
  validationOutcome: string;
  testedLogicChoice: string;
  durationMs: number;
  startedAt: string | null;
  completedAt: string | null;
}

interface Props {
  packId: string;
  hasExistingIssue?: boolean;
  defaultRepo?: string;
}

const STATUS_STYLE: Record<string, string> = {
  success: "bg-success/15 text-success border-success/40",
  failure: "bg-danger/15 text-danger border-danger/40",
  timeout: "bg-warning/15 text-warning border-warning/40",
  running: "bg-info/15 text-info border-info/40",
  queued:  "bg-muted/15 text-muted-foreground border-border",
};

export default function ReportsTab({ packId, hasExistingIssue, defaultRepo }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushingRunId, setPushingRunId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${packId}/runs?limit=30`);
      const data = await r.json();
      setRuns(data.items || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [packId]);

  const downloadReport = (runId: string) => {
    window.location.href = `/api/enterprise-use-cases/${packId}/runs/${runId}/report?format=md`;
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Run reports</h3>
        <span className="text-[10px] text-muted-foreground">{runs.length} run(s)</span>
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {loading && runs.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
          <Inbox className="h-7 w-7 mx-auto mb-2 text-accent opacity-70" />
          <h3 className="text-sm font-semibold text-foreground">No runs to report on</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Reports are generated per run. Execute a scenario from the <span className="font-mono">Runs</span> tab first.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-3 flex items-start gap-3">
              <Activity className="h-4 w-4 text-accent mt-0.5 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", STATUS_STYLE[r.status] || STATUS_STYLE.queued)}>{r.status}</span>
                  <CoverageBadge outcome={r.validationOutcome as CoverageOutcome} mode={r.mode as any} />
                  <span className="text-[10px] text-muted-foreground font-mono">{r.environmentName || "?"} · {r.environmentKind || "?"}</span>
                  <span className="text-[10px] text-muted-foreground">logic: <span className="font-mono text-accent">{r.testedLogicChoice}</span></span>
                  <span className="text-[10px] text-muted-foreground">{r.durationMs}ms</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : "?"}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => downloadReport(r.id)}
                  className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover"
                  title="Download Markdown report"
                >
                  <Download className="h-3 w-3" /> Report .md
                </button>
                <button
                  onClick={() => setPushingRunId(r.id)}
                  className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover"
                  title="Push to GitHub"
                >
                  <GitPullRequest className="h-3 w-3" /> {hasExistingIssue ? "Update issue" : "Push to GitHub"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pushingRunId && (
        <GithubPushDialog
          packId={packId}
          runId={pushingRunId}
          defaultRepo={defaultRepo}
          hasExistingIssue={hasExistingIssue}
          onClose={() => setPushingRunId(null)}
          onPushed={() => { setPushingRunId(null); }}
        />
      )}

      {/* Comments per pack (separately shown also in Comments tab; here as a compact summary) */}
      <CommentThread packId={packId} />
    </div>
  );
}
