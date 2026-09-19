"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertTriangle, Trash2, Pencil, GitPullRequest } from "lucide-react";
import PackHeader from "@/components/detection-packs/PackHeader";
import RuleTabs from "@/components/detection-packs/RuleTabs";
import SimulationsList from "@/components/detection-packs/SimulationsList";
import IrPlaybookView from "@/components/detection-packs/IrPlaybookView";
import IrPlaybookEditor from "@/components/detection-packs/IrPlaybookEditor";
import ReferencesList from "@/components/detection-packs/ReferencesList";
import GithubPushDialog from "@/components/detection-packs/GithubPushDialog";

interface PackDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  severity: string;
  riskScore: number;
  category: string;
  status: string;
  platforms: string[];
  dataSources: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  references: Array<{ title: string; url: string; type: string }>;
  sourceType: string;
  sourceTable: string;
  sourceRefId: string;
  createdAt: string;
  rules: Array<{ id: string; format: string; title: string; body: string; language: string; validationStatus: string; falsePositives: string[] }>;
  simulations: Array<{ id: string; framework: string; refId: string; techniqueId: string; displayName: string; description: string; rationale: string }>;
  irPlaybook: any;
  githubIssueUrl: string | null;
  githubIssueNumber: number | null;
}

const STATUSES = ["draft", "test", "tune", "validate", "production", "deprecated"] as const;

export default function DetectionPackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<PackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [editingIrp, setEditingIrp] = useState(false);
  const [githubOpen, setGitPullRequestOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/detection-packs/${id}`)
      .then(async (r) => {
        if (!r.ok) { setError((await r.json()).error || `HTTP ${r.status}`); return; }
        const d = await r.json();
        setData(d);
      })
      .catch((err) => setError(err?.message || "Load failed"))
      .finally(() => setLoading(false));
  }, [id]);

  const updateStatus = async (newStatus: string) => {
    if (!data) return;
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/detection-packs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setData({ ...data, status: newStatus });
    } finally {
      setSavingStatus(false);
    }
  };

  const archive = async () => {
    if (!confirm("Archive this pack? It will be marked deprecated but kept in the database.")) return;
    const res = await fetch(`/api/detection-packs/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/detections/packs");
  };

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  );
  if (error || !data) return (
    <div className="p-6">
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger inline-flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> {error || "Pack not found"}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/detections/packs" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Detection Packs
      </Link>

      <PackHeader
        name={data.name}
        description={data.description}
        severity={data.severity}
        riskScore={data.riskScore}
        category={data.category}
        status={data.status}
        platforms={data.platforms}
        dataSources={data.dataSources}
        mitreTechniques={data.mitreTechniques}
        mitreTactics={data.mitreTactics}
        sourceType={data.sourceType}
        sourceTable={data.sourceTable}
        sourceRefId={data.sourceRefId}
        createdAt={data.createdAt}
        rightActions={
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={data.status}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={savingStatus}
              className="text-[11px] rounded-md border border-border bg-input text-foreground px-2 py-1 focus:outline-none focus:border-accent"
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {savingStatus && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <button
              onClick={() => setGitPullRequestOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover"
              title={data.githubIssueUrl ? "Update existing GitHub issue" : "Push to GitHub as a tracked issue"}
            >
              <GitPullRequest className="h-3 w-3" />
              {data.githubIssueUrl ? `Issue #${data.githubIssueNumber}` : "Push to GitHub"}
            </button>
            <button
              onClick={archive}
              className="inline-flex items-center gap-1 text-[11px] text-danger hover:bg-danger/10 px-2 py-1 rounded"
              title="Archive (status=deprecated)"
            >
              <Trash2 className="h-3 w-3" /> Archive
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: rules + simulations (wider) */}
        <div className="lg:col-span-2 space-y-4">
          <RuleTabs rules={data.rules} />
          <SimulationsList sims={data.simulations} />
        </div>
        {/* Right: IRP + references */}
        <div className="space-y-4">
          {editingIrp ? (
            <IrPlaybookEditor
              packId={data.id}
              initialIrp={data.irPlaybook}
              onSaved={(irp) => setData({ ...data, irPlaybook: irp })}
              onCancel={() => setEditingIrp(false)}
            />
          ) : (
            <div className="relative">
              <button
                onClick={() => setEditingIrp(true)}
                className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border bg-card text-foreground hover:bg-card-hover"
                title="Edit playbook steps"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <IrPlaybookView irp={data.irPlaybook} />
            </div>
          )}
          <ReferencesList refs={data.references} />
        </div>
      </div>

      <GithubPushDialog
        open={githubOpen}
        onClose={() => setGitPullRequestOpen(false)}
        packId={data.id}
        status={data.status}
        existingIssueUrl={data.githubIssueUrl ?? null}
        existingIssueNumber={data.githubIssueNumber ?? null}
        onPushed={(issueUrl, issueNumber) => {
          setData({ ...data, githubIssueUrl: issueUrl, githubIssueNumber: issueNumber });
          setGitPullRequestOpen(false);
        }}
      />
    </div>
  );
}
