"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Upload, Loader2, AlertTriangle, CheckCircle2, FileCode2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import UploadPreviewTable, { type PreviewItem } from "@/components/enterprise-use-cases/UploadPreviewTable";

interface UploadResult {
  batchId: string;
  filename: string;
  format: string;
  parsedRowCount: number;
  parseErrors: Array<{ row: string; message: string }>;
  preview: PreviewItem[];
}

export default function EnterpriseUploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<"upload" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadResult | null>(null);
  const [includeRed, setIncludeRed] = useState(false);
  const [committed, setCommitted] = useState<{ createdRowCount: number; skippedRowCount: number; errorRowCount: number; autoRecommendedCount?: number; autoScenariosCount?: number } | null>(null);

  // Paste mode
  const [pasteText, setPasteText] = useState("");
  const [pasteName, setPasteName] = useState("paste.txt");

  const uploadFile = async (file: File) => {
    setBusy("upload"); setError(null); setPreview(null); setCommitted(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/enterprise-use-cases/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Upload failed"); return; }
      setPreview(data);
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally { setBusy(null); }
  };

  const uploadText = async () => {
    if (!pasteText.trim()) return;
    setBusy("upload"); setError(null); setPreview(null); setCommitted(null);
    try {
      const res = await fetch("/api/enterprise-use-cases/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: pasteName, text: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Upload failed"); return; }
      setPreview(data);
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally { setBusy(null); }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy("commit"); setError(null);
    try {
      const res = await fetch(`/api/enterprise-use-cases/upload/${preview.batchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeRed }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Commit failed"); return; }
      setCommitted({
        createdRowCount: data.createdRowCount,
        skippedRowCount: data.skippedRowCount,
        errorRowCount: data.errorRowCount,
        autoRecommendedCount: data.autoRecommendedCount,
        autoScenariosCount: data.autoScenariosCount,
      });
      // After 2 seconds, jump to the list
      setTimeout(() => router.push("/detections/enterprise"), 2000);
    } catch (err: any) {
      setError(err?.message || "Commit failed");
    } finally { setBusy(null); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <Link href="/detections/enterprise" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Enterprise Use Cases
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Upload className="h-6 w-6 text-accent" />
          Upload custom use cases
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop a spreadsheet, runbook, or rule file. One file can carry many use cases. Validation runs on every parsed row before commit.
        </p>
      </div>

      {!preview && !committed && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "rounded-xl border-2 border-dashed border-border p-10 text-center cursor-pointer transition-colors",
              "hover:border-accent/50 hover:bg-card",
              busy === "upload" && "opacity-50 pointer-events-none",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm,.xls,.csv,.tsv,.md,.markdown,.txt,.text,.yml,.yaml,.toml,.spl,.kql,.yara,.yar"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
            />
            <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            {busy === "upload" ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
              </div>
            ) : (
              <>
                <p className="text-sm text-foreground font-medium">Drop a use-case file here</p>
                <p className="text-xs text-muted-foreground mt-0.5">or click to browse · max 5 MB</p>
                <p className="text-[11px] text-muted-foreground mt-3">
                  .xlsx · .csv · .md · .txt · .yml · .toml · .spl · .kql · .yara
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Spreadsheet headers like <code className="font-mono">name | description | detection_logic | severity | platform | mitre_techniques</code> are auto-mapped.
                </p>
              </>
            )}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Paste content instead</summary>
            <div className="mt-2 space-y-2">
              <input
                type="text" value={pasteName} onChange={(e) => setPasteName(e.target.value)}
                placeholder="filename.md"
                className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
              />
              <textarea
                value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste rule body, markdown runbook, or CSV content here…"
                rows={10}
                className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
              />
              <button
                onClick={uploadText}
                disabled={busy !== null || !pasteText.trim()}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
              >
                {busy === "upload" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Parse pasted content
              </button>
            </div>
          </details>
        </>
      )}

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}

      {committed && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-3 text-sm text-success flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5" />
          <div>
            Committed {committed.createdRowCount} use case{committed.createdRowCount !== 1 ? "s" : ""}
            {committed.skippedRowCount > 0 && <> · skipped {committed.skippedRowCount} red</>}
            {committed.errorRowCount > 0 && <> · {committed.errorRowCount} errored</>}.
            {(committed.autoRecommendedCount || committed.autoScenariosCount) ? (
              <div className="text-[11px] text-muted-foreground mt-1">
                Auto-mapped: {committed.autoRecommendedCount ?? 0} recommended logic generated · {committed.autoScenariosCount ?? 0} scenario(s) created
              </div>
            ) : null}
            <div className="text-[11px] text-muted-foreground mt-1">Redirecting to the list…</div>
          </div>
        </div>
      )}

      {preview && !committed && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <FileCode2 className="h-3.5 w-3.5 text-accent" />
              <span className="font-mono">{preview.filename}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-[10px] text-muted-foreground">format={preview.format}</span>
            </div>
            <button
              onClick={() => { setPreview(null); setError(null); }}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Discard preview
            </button>
          </div>

          <UploadPreviewTable items={preview.preview} parseErrors={preview.parseErrors} />

          <div className="flex items-center justify-end gap-3 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox" checked={includeRed} onChange={(e) => setIncludeRed(e.target.checked)}
                className="accent-accent"
              />
              Include red rows (commit even when validation failed)
            </label>
            <button
              onClick={commit}
              disabled={busy !== null || preview.preview.length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
            >
              {busy === "commit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Commit {preview.preview.filter((p) => p.validationStatus !== "red" || includeRed).length} use case{preview.preview.length !== 1 ? "s" : ""}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
