"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Download, Trash2, Loader2, Archive, FileCode2, FlaskConical, Workflow,
  Copy, Check, AlertTriangle, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import StratusRunPanel from "@/components/use-cases/StratusRunPanel";

interface UseCaseDetail {
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
  createdAt: string;
  updatedAt: string;
  steps: Array<{
    id: string;
    orderIndex: number;
    kind: string;
    techniqueId: string;
    displayName: string;
    parameters: Record<string, unknown>;
    expectedSignal: string;
    notes: string;
  }>;
  playbooks: Array<{
    id: string;
    format: string;
    version: number;
    body: string;
    checksum: string;
    generator: string;
    createdAt: string;
  }>;
}

const FORMATS = [
  { id: "atomic-yaml", label: "ART YAML", icon: FlaskConical, ext: "yml" },
  { id: "purplesharp-json", label: "PurpleSharp JSON", icon: FileCode2, ext: "json" },
  { id: "stratus-sh", label: "Stratus shell", icon: Workflow, ext: "sh" },
] as const;

export default function UseCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<UseCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{ format: string; body: string; warnings?: Record<string, number>; emitted?: number; version: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/use-cases/${id}`);
      if (!res.ok) throw new Error("not found");
      setData(await res.json());
    } catch { setData(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const doExport = async (format: string) => {
    setExporting(format);
    setExportResult(null);
    try {
      const res = await fetch(`/api/use-cases/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      const result = await res.json();
      if (res.ok) {
        setExportResult({ format, body: result.body, warnings: result.warnings, emitted: result.emitted, version: result.version });
        fetchDetail();
      }
    } finally { setExporting(null); }
  };

  const archive = async () => {
    if (!confirm("Archive this use case?")) return;
    await fetch(`/api/use-cases/${id}`, { method: "DELETE" });
    router.push("/use-cases");
  };

  const download = (format: string, body: string) => {
    const fmt = FORMATS.find((f) => f.id === format);
    const ext = fmt?.ext || "txt";
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "usecase"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!data) return <div className="p-6 text-danger">Use case not found.</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-foreground truncate">{data.name}</h1>
            <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
              data.authorMode === "atomic" ? "bg-accent/15 text-accent" :
              data.authorMode === "purplesharp" ? "bg-purple/15 text-purple" :
              "bg-info/15 text-info",
            )}>{data.authorMode}</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase bg-muted/15 text-muted-foreground">{data.status}</span>
          </div>
          <p className="text-sm text-muted-foreground">{data.description || <span className="italic">No description</span>}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.mitreTechniques.map((t) => (
              <span key={t} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent">{t}</span>
            ))}
          </div>
        </div>
        <button
          onClick={archive}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-danger/30 text-danger hover:bg-danger/10 text-xs font-medium"
        >
          <Trash2 className="h-3.5 w-3.5" /> Archive
        </button>
      </div>

      {/* Steps */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Steps ({data.steps.length})</h2>
        </div>
        {data.steps.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">No steps yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.steps.map((s) => (
              <div key={s.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-muted-foreground">{String(s.orderIndex + 1).padStart(2, "0")}</span>
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                    s.kind === "atomic" ? "bg-accent/15 text-accent" :
                    s.kind === "purplesharp" ? "bg-purple/15 text-purple" :
                    s.kind === "stratus" ? "bg-info/15 text-info" :
                    "bg-muted/15 text-muted-foreground",
                  )}>{s.kind}</span>
                  {s.techniqueId && (
                    <span className="text-[11px] font-mono text-accent">{s.techniqueId}</span>
                  )}
                  <span className="text-xs font-medium text-foreground">{s.displayName}</span>
                </div>
                {s.expectedSignal && (
                  <p className="text-[11px] text-muted-foreground ml-7"><span className="text-success">Expected signal:</span> {s.expectedSignal}</p>
                )}
                {s.notes && <p className="text-[11px] text-muted-foreground ml-7 italic">{s.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Export</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-4">
          {FORMATS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                onClick={() => doExport(f.id)}
                disabled={!!exporting}
                className="inline-flex items-center justify-between gap-2 h-11 px-3 rounded-lg border border-border hover:bg-card-hover transition-colors disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2 text-sm text-foreground">
                  <Icon className="h-4 w-4 text-accent" /> {f.label}
                </span>
                {exporting === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            );
          })}
        </div>

        {exportResult && (
          <div className="border-t border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-foreground">
                <span className="font-semibold">{exportResult.format}</span>
                <span className="text-muted-foreground"> · v{exportResult.version}</span>
                {exportResult.emitted !== undefined && (
                  <span className="text-muted-foreground"> · {exportResult.emitted} test(s)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(exportResult.body);
                    setCopied(true); setTimeout(() => setCopied(false), 1200);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />} copy
                </button>
                <button
                  onClick={() => download(exportResult.format, exportResult.body)}
                  className="inline-flex items-center gap-1 text-xs text-accent hover:text-[#60a5fa]"
                >
                  <Download className="h-3 w-3" /> download
                </button>
              </div>
            </div>
            {exportResult.warnings && Object.keys(exportResult.warnings).length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>Skipped steps:&nbsp;
                  {Object.entries(exportResult.warnings).map(([k, n]) => `${n} ${k}`).join(" · ")}
                </span>
              </div>
            )}
            <pre className="max-h-[400px] overflow-auto rounded-lg border border-border bg-[#0d1117] p-3 text-[11px] font-mono text-emerald-300 whitespace-pre-wrap">
              {exportResult.body}
            </pre>
          </div>
        )}
      </div>

      {/* Stratus runner (only renders when any step is kind="stratus") */}
      <StratusRunPanel useCaseId={data.id} steps={data.steps} />

      {/* Playbook history */}
      {data.playbooks.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Playbook history ({data.playbooks.length})</h2>
          </div>
          <div className="divide-y divide-border text-xs">
            {data.playbooks.map((p) => (
              <div key={p.id} className="px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-foreground">{p.format}</span>
                  <span className="text-muted-foreground">v{p.version}</span>
                  <span className="text-[10px] text-muted-foreground">· {p.generator}</span>
                  {p.checksum && p.checksum !== "stub" && (
                    <span className="text-[10px] font-mono text-muted-foreground">· {p.checksum}</span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
