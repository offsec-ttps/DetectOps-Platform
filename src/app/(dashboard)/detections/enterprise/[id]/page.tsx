"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, AlertTriangle, Trash2, RefreshCw, FileCode2,
  Layers, Activity, ListChecks, FileText, MessageSquare, Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import EnterpriseUseCaseHeader from "@/components/enterprise-use-cases/EnterpriseUseCaseHeader";
import SiemCompatMatrix from "@/components/enterprise-use-cases/SiemCompatMatrix";
import { type ValidationVerdict } from "@/components/enterprise-use-cases/ValidationBadge";
import DetectionLogicTab from "@/components/enterprise-use-cases/DetectionLogicTab";
import ScenarioList from "@/components/enterprise-use-cases/ScenarioList";
import RunDialog from "@/components/enterprise-use-cases/RunDialog";
import RunLogPanel from "@/components/enterprise-use-cases/RunLogPanel";
import ReportsTab from "@/components/enterprise-use-cases/ReportsTab";
import CommentThread from "@/components/enterprise-use-cases/CommentThread";
import PromoteButton from "@/components/enterprise-use-cases/PromoteButton";
import CommunityMatchesPanel from "@/components/enterprise-use-cases/CommunityMatchesPanel";

interface UcDetail {
  id: string;
  name: string;
  description: string;
  originalDetectionLogic: string;
  recommendedDetectionLogic: string;
  recommendedSpl: string;
  recommendedKql: string;
  recommendedNotes: any;
  editedDetectionLogic: string;
  editedSpl: string;
  editedKql: string;
  selectedLogic: string;
  selectedFormat: string;
  format: string;
  severity: string;
  platforms: string[];
  dataSources: string[];
  owner: string;
  sourceFilename: string | null;
  sourceRowRef: string;
  status: string;
  validationStatus: ValidationVerdict;
  validationDetails: any;
  lastValidatedAt: string | null;
  nextValidationDueAt: string | null;
  validationCadenceDays: number;
  siemCompatibility: Record<string, string>;
  mitreTechniques: string[];
  mitreTactics: string[];
  createdAt: string;
  githubIssueUrl?: string | null;
  githubIssueNumber?: number | null;
  scenarios: Array<{ id: string; ordinal: number; name: string; description?: string; steps?: Array<{ framework: string }>; source?: string }>;
  recentRuns: Array<{ id: string; mode: string; status: string; validationOutcome: string; createdAt: string }>;
  comments: Array<{ id: string; author: string; body: string; kind: string; createdAt: string }>;
}

const TABS = [
  { id: "overview",   label: "Overview",        Icon: Activity      },
  { id: "logic",      label: "Detection Logic", Icon: FileCode2     },
  { id: "mapping",    label: "Mapping",         Icon: Layers        },
  { id: "scenarios",  label: "Scenarios",       Icon: ListChecks    },
  { id: "runs",       label: "Runs",            Icon: Activity      },
  { id: "reports",    label: "Reports",         Icon: FileText      },
  { id: "comments",   label: "Comments",        Icon: MessageSquare },
] as const;

export default function EnterpriseUseCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<UcDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]["id"]>("overview");
  const [revalidating, setRevalidating] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runRefreshKey, setRunRefreshKey] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${id}`);
      if (!r.ok) { setError((await r.json()).error || `HTTP ${r.status}`); return; }
      setData(await r.json());
    } catch (err: any) {
      setError(err?.message || "Load failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const revalidate = async () => {
    setRevalidating(true);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${id}/validate`, { method: "POST" });
      if (r.ok) {
        const v = await r.json();
        if (data) {
          setData({ ...data,
            validationStatus: v.validationStatus,
            validationDetails: v.validationDetails,
            siemCompatibility: v.siemCompatibility,
            lastValidatedAt: v.lastValidatedAt,
            nextValidationDueAt: v.nextValidationDueAt,
          });
        }
      }
    } finally { setRevalidating(false); }
  };

  const retire = async () => {
    if (!confirm("Retire this use case? (status='retired')")) return;
    const r = await fetch(`/api/enterprise-use-cases/${id}`, { method: "DELETE" });
    if (r.ok) router.push("/detections/enterprise");
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (error || !data) return (
    <div className="p-6">
      <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger inline-flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> {error || "Use case not found"}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/detections/enterprise" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Enterprise Use Cases
      </Link>

      <EnterpriseUseCaseHeader
        name={data.name}
        description={data.description}
        severity={data.severity}
        status={data.status}
        validationStatus={data.validationStatus}
        validationDetails={data.validationDetails}
        format={data.format}
        owner={data.owner}
        platforms={data.platforms}
        mitreTechniques={data.mitreTechniques}
        sourceFilename={data.sourceFilename}
        sourceRowRef={data.sourceRowRef}
        lastValidatedAt={data.lastValidatedAt}
        nextValidationDueAt={data.nextValidationDueAt}
        validationCadenceDays={data.validationCadenceDays}
        rightActions={
          <div className="flex items-center gap-2">
            <button
              onClick={revalidate}
              disabled={revalidating}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-border text-foreground hover:bg-card-hover disabled:opacity-50"
            >
              {revalidating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Re-validate
            </button>
            <PromoteButton
              packId={data.id}
              ucStatus={data.status}
              hasMatchedRun={(data.recentRuns || []).some((r) => r.validationOutcome === "matched")}
              onPromoted={() => load()}
            />
            <button
              onClick={retire}
              className="inline-flex items-center gap-1 text-[11px] text-danger hover:bg-danger/10 px-2 py-1 rounded"
            >
              <Trash2 className="h-3 w-3" /> Retire
            </button>
          </div>
        }
      />

      <div className="border-b border-border flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.id ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.Icon className="h-3.5 w-3.5" />
            {t.label}
            {"badge" in t && t.badge && (
              <span className="ml-1 text-[9px] uppercase tracking-wider px-1 rounded bg-muted/15 text-muted-foreground">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <SiemCompatMatrix matrix={data.siemCompatibility} format={data.format} />
            <ValidationDetailsPanel details={data.validationDetails} />
          </div>
          <div className="space-y-4">
            <FactsPanel data={data} />
          </div>
        </div>
      )}

      {tab === "logic" && (
        <DetectionLogicTab
          packId={data.id}
          format={data.format}
          originalBody={data.originalDetectionLogic}
          recommendedBody={data.recommendedDetectionLogic}
          recommendedSpl={data.recommendedSpl || ""}
          recommendedKql={data.recommendedKql || ""}
          editedBody={data.editedDetectionLogic}
          editedSpl={data.editedSpl || ""}
          editedKql={data.editedKql || ""}
          recommendedNotes={data.recommendedNotes || {}}
          selected={data.selectedLogic as "original" | "recommended" | "edited"}
          selectedFormat={(data.selectedFormat as "sigma" | "spl" | "kql") || "sigma"}
          onUpdated={(next) => {
            if (!data) return;
            setData({
              ...data,
              selectedLogic: next.selectedLogic,
              selectedFormat: next.selectedFormat,
              editedDetectionLogic: next.editedDetectionLogic,
              editedSpl: next.editedSpl,
              editedKql: next.editedKql,
              recommendedDetectionLogic: next.recommendedDetectionLogic,
              recommendedSpl: next.recommendedSpl,
              recommendedKql: next.recommendedKql,
              recommendedNotes: next.recommendedNotes,
              validationStatus: (next.validationStatus as ValidationVerdict) || data.validationStatus,
              siemCompatibility: Object.keys(next.siemCompatibility).length ? next.siemCompatibility : data.siemCompatibility,
            });
          }}
        />
      )}

      {tab === "mapping" && (
        <div className="space-y-3">
          <SiemCompatMatrix matrix={data.siemCompatibility} format={data.format} />
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs font-semibold text-foreground mb-2">MITRE ATT&CK techniques mapped to this use case</h3>
            {data.mitreTechniques.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No techniques extracted. Edit metadata to add them — auto-suggestions need at least one.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.mitreTechniques.map((t) => (
                  <a
                    key={t}
                    href={`https://attack.mitre.org/techniques/${t.replace(".", "/")}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-mono text-accent hover:underline"
                  >
                    {t}
                  </a>
                ))}
              </div>
            )}
          </div>
          <CommunityMatchesPanel packId={data.id} />
        </div>
      )}

      {tab === "scenarios" && (
        <ScenarioList
          packId={data.id}
          techniques={data.mitreTechniques}
          onCountChange={() => { /* status reflected in pack header on next reload */ }}
        />
      )}

      {tab === "runs" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Execute scenarios against any environment. <Link href="/detections/enterprise/environments" className="text-accent hover:underline">Manage environments →</Link>
            </p>
            <button
              onClick={() => setRunDialogOpen(true)}
              disabled={!data || (data.scenarios?.length || 0) === 0}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
              title={(data?.scenarios?.length || 0) === 0 ? "Define at least one scenario first" : "Run a scenario"}
            >
              <Play className="h-3.5 w-3.5" /> Run scenario
            </button>
          </div>
          <RunLogPanel packId={data.id} refreshKey={runRefreshKey} />
          {runDialogOpen && (
            <RunDialog
              packId={data.id}
              scenarios={data.scenarios.map((s) => ({ id: s.id, ordinal: s.ordinal, name: s.name, source: s.source || "", steps: s.steps || [] }))}
              selectedLogicChoice={data.selectedLogic as "original" | "recommended" | "edited"}
              onClose={() => setRunDialogOpen(false)}
              onCompleted={() => {
                setRunDialogOpen(false);
                setRunRefreshKey((k) => k + 1);
                load();
              }}
            />
          )}
        </div>
      )}

      {tab === "reports" && (
        <ReportsTab
          packId={data.id}
          hasExistingIssue={!!data.githubIssueUrl}
        />
      )}

      {tab === "comments" && (
        <CommentThread packId={data.id} />
      )}
    </div>
  );
}

function ValidationDetailsPanel({ details }: { details: any }) {
  const checks = details?.checks || {};
  const entries = Object.entries(checks) as Array<[string, { ok: boolean; severity: string; message: string }]>;
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        No validation has run yet. Click <span className="font-mono">Re-validate</span> above.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground">Validation checks</h3>
      </div>
      <div className="divide-y divide-border">
        {entries.map(([key, c]) => (
          <div key={key} className="px-4 py-2 flex items-start gap-2 text-xs">
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border",
              c.ok ? "bg-success/15 text-success border-success/40"
                   : c.severity === "warn" ? "bg-warning/15 text-warning border-warning/40"
                                            : "bg-danger/15 text-danger border-danger/40",
            )}>{c.ok ? "ok" : c.severity}</span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] text-muted-foreground">{key}</div>
              <div className="text-foreground">{c.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FactsPanel({ data }: { data: UcDetail }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground">Use case facts</h3>
      </div>
      <div className="divide-y divide-border text-xs">
        <Fact label="Data sources" value={data.dataSources.length ? data.dataSources.join(", ") : "—"} />
        <Fact label="Tactics" value={data.mitreTactics.length ? data.mitreTactics.join(", ") : "—"} />
        <Fact label="Format" value={data.format || "—"} mono />
        <Fact label="Created" value={new Date(data.createdAt).toLocaleString()} />
        {data.sourceFilename && <Fact label="Source file" value={data.sourceFilename} mono />}
        {data.sourceRowRef && <Fact label="Source row" value={data.sourceRowRef} mono />}
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-4 py-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={cn("mt-0.5 text-foreground", mono && "font-mono text-[11px]")}>{value}</div>
    </div>
  );
}
