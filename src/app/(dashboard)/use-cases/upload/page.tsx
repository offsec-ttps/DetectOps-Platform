"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Upload, FileCode2, Sparkles, Loader2, ArrowUpRight,
  AlertTriangle, CheckCircle2, FlaskConical, Cloud, Layers, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface InferResult {
  id: string;
  filename: string;
  format: string;
  formatConfidence: number;
  formatReason: string;
  techniques: string[];
  tactics: string[];
  logsource: string;
  summary: string;
  mappings: {
    atomic:      Array<{ techniqueId: string; testGuid: string; testName: string }>;
    purplesharp: Array<{ techniqueId: string; variation: number; variationLabel: string }>;
    stratus:     Array<{ attackId: string; name: string; platform: string }>;
  };
}

const FORMAT_COLORS: Record<string, string> = {
  sigma: "bg-accent/15 text-accent border-accent/30",
  spl: "bg-purple/15 text-purple border-purple/30",
  "elastic-toml": "bg-warning/15 text-warning border-warning/30",
  kql: "bg-info/15 text-info border-info/30",
  "yaml-unknown": "bg-muted/15 text-muted-foreground border-border",
  unknown: "bg-muted/15 text-muted-foreground border-border",
};

export default function UploadDetectionPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteName, setPasteName] = useState("pasted-rule.yml");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InferResult | null>(null);

  // Materialise state
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [matMode, setMatMode] = useState<"ai" | "direct">("direct");
  const [matBusy, setMatBusy] = useState(false);
  const [matResult, setMatResult] = useState<{ useCaseId: string; stepCount: number; mode: string } | null>(null);
  const [matError, setMatError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/use-cases/ai/generations?pageSize=1")
      .then((r) => r.json())
      .then((d) => setAiConfigured(d?.config?.anthropic === "configured"))
      .catch(() => setAiConfigured(false));
  }, []);

  const uploadFile = async (file: File) => {
    setBusy(true); setError(null); setResult(null); setMatResult(null); setMatError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploaded-detections", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Upload failed"); return; }
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally { setBusy(false); }
  };

  const uploadText = async () => {
    if (!pasteText.trim()) return;
    setBusy(true); setError(null); setResult(null); setMatResult(null); setMatError(null);
    try {
      const res = await fetch("/api/uploaded-detections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: pasteName, body: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Upload failed"); return; }
      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally { setBusy(false); }
  };

  const materialise = async () => {
    if (!result) return;
    setMatBusy(true); setMatError(null); setMatResult(null);
    try {
      const res = await fetch(`/api/uploaded-detections/${result.id}/to-use-case`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: matMode }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.includes?.("ANTHROPIC")) setAiConfigured(false);
        setMatError(data.error || "Materialise failed");
        return;
      }
      setMatResult(data);
    } catch (err: any) {
      setMatError(err?.message || "Materialise failed");
    } finally { setMatBusy(false); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Use Cases
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Upload className="h-6 w-6 text-accent" />
          Upload detection
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop a Sigma YAML, Splunk SPL, Elastic TOML, or KQL rule. The platform sniffs the format, extracts
          techniques, and suggests ART / PurpleSharp / Stratus steps that would trigger it.
        </p>
      </div>

      {/* Drop zone */}
      {!result && (
        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "rounded-xl border-2 border-dashed border-border p-10 text-center cursor-pointer transition-colors",
            "hover:border-accent/50 hover:bg-card",
            busy && "opacity-50 pointer-events-none",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".yml,.yaml,.toml,.spl,.kql,.txt,.json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
          />
          <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          {busy ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground font-medium">Drop a detection file here</p>
              <p className="text-xs text-muted-foreground mt-0.5">or click to browse · max 256 KB</p>
              <p className="text-[11px] text-muted-foreground mt-3">
                .yml · .yaml · .toml · .spl · .kql · .txt
              </p>
            </>
          )}
        </div>
      )}

      {/* Paste mode */}
      {!result && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Paste rule text instead</summary>
          <div className="mt-2 space-y-2">
            <input
              type="text" value={pasteName} onChange={(e) => setPasteName(e.target.value)}
              placeholder="filename.yml"
              className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
            />
            <textarea
              value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste your rule body here…"
              rows={8}
              className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
            />
            <button
              onClick={uploadText}
              disabled={busy || !pasteText.trim()}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Parse pasted rule
            </button>
          </div>
        </details>
      )}

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Preview */}
      {result && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-accent" />
              <span className="text-sm font-medium text-foreground">{result.filename}</span>
              <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", FORMAT_COLORS[result.format])}>
                {result.format}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {(result.formatConfidence * 100).toFixed(0)}% · {result.formatReason}
              </span>
            </div>
            <button
              onClick={() => { setResult(null); setMatResult(null); setMatError(null); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <p className="text-xs text-muted-foreground">{result.summary}</p>

            {/* Techniques */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Extracted techniques ({result.techniques.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.techniques.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">No technique IDs found in file.</span>
                ) : result.techniques.map((t) => (
                  <span key={t} className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-mono font-bold text-accent">{t}</span>
                ))}
              </div>
            </div>

            {/* Mappings */}
            <div className="grid md:grid-cols-3 gap-3">
              <MappingPanel
                title="Atomic Red Team"
                icon={<FlaskConical className="h-4 w-4" />}
                color="accent"
                items={result.mappings.atomic.map((a) => `${a.techniqueId} — ${a.testName}`)}
              />
              <MappingPanel
                title="PurpleSharp"
                icon={<FileCode2 className="h-4 w-4" />}
                color="purple"
                items={result.mappings.purplesharp.map((p) => `${p.techniqueId} v${p.variation}${p.variationLabel ? ` · ${p.variationLabel}` : ""}`)}
              />
              <MappingPanel
                title="Stratus"
                icon={<Cloud className="h-4 w-4" />}
                color="info"
                items={result.mappings.stratus.map((s) => `${s.platform} · ${s.name}`)}
              />
            </div>

            {/* Materialise */}
            <div className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground">Create Use Case</span>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio" name="matMode" checked={matMode === "direct"}
                    onChange={() => setMatMode("direct")} className="accent-[#3b82f6]"
                  />
                  <span className="text-foreground">Direct (stub from suggestions)</span>
                </label>
                <label className={cn("flex items-center gap-1.5 cursor-pointer", aiConfigured === false && "opacity-40 cursor-not-allowed")}>
                  <input
                    type="radio" name="matMode" checked={matMode === "ai"}
                    onChange={() => setMatMode("ai")}
                    disabled={aiConfigured === false}
                    className="accent-[#3b82f6]"
                  />
                  <span className="text-foreground inline-flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> AI (full playbook)
                    {aiConfigured === false && <span className="text-[10px] text-muted-foreground">(no API key)</span>}
                  </span>
                </label>
              </div>

              {matError && (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {matError}
                </div>
              )}

              {matResult ? (
                <div className="rounded-md border border-success/30 bg-success/10 px-3 py-3 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="font-medium">Use case created ({matResult.stepCount} step{matResult.stepCount !== 1 ? "s" : ""}, {matResult.mode})</span>
                  </div>
                  <Link
                    href={`/use-cases/${matResult.useCaseId}`}
                    className="inline-flex items-center gap-1 text-accent hover:text-[#60a5fa] font-medium"
                  >
                    Open Use Case <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <button
                  onClick={materialise}
                  disabled={matBusy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
                >
                  {matBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Layers className="h-3 w-3" />}
                  Create Use Case ({matMode})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MappingPanel({ title, icon, color, items }: {
  title: string; icon: React.ReactNode; color: "accent" | "purple" | "info"; items: string[];
}) {
  const colorClasses = {
    accent: "border-accent/30 text-accent",
    purple: "border-purple/30 text-purple",
    info: "border-info/30 text-info",
  };
  return (
    <div className={cn("rounded-lg border bg-background/30 px-3 py-2", colorClasses[color])}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">No matches</p>
      ) : (
        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
          {items.slice(0, 8).map((it, i) => (
            <li key={i} className="text-[11px] text-foreground truncate" title={it}>{it}</li>
          ))}
          {items.length > 8 && <li className="text-[10px] text-muted-foreground">+{items.length - 8} more…</li>}
        </ul>
      )}
    </div>
  );
}
