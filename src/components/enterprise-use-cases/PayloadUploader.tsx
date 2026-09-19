"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, FileCode2, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface PayloadMeta {
  sha256: string;
  sizeBytes: number;
  ext: string;
  storedAt: string;
  filename: string;
  payloadRef: string;
}

interface Props {
  envId: string;
  initial?: { payloadRef?: string; sha256?: string; sizeBytes?: number; filename?: string; ext?: string };
  onUploaded?: (meta: PayloadMeta) => void;
}

export default function PayloadUploader({ envId, initial, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<PayloadMeta | null>(
    initial?.payloadRef ? {
      sha256: initial.sha256 || "",
      sizeBytes: initial.sizeBytes || 0,
      ext: initial.ext || "",
      storedAt: "",
      filename: initial.filename || "payload",
      payloadRef: initial.payloadRef,
    } : null
  );

  const upload = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/environment-targets/${envId}/payload`, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "upload failed"); return; }
      setMeta(data);
      onUploaded?.(data);
    } catch (err: any) {
      setError(err?.message || "upload failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-warning font-semibold">
        <ShieldAlert className="h-3 w-3" /> Shell payload artefact
      </div>

      {meta && (
        <div className="rounded border border-border bg-card px-2 py-1.5 flex items-center gap-2 text-[11px]">
          <FileCode2 className="h-3 w-3 text-accent flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono truncate">{meta.filename}</div>
            <div className="text-[10px] text-muted-foreground font-mono">
              sha256: {meta.sha256.slice(0, 16)}…
              {meta.sizeBytes > 0 && <> · {fmtBytes(meta.sizeBytes)}</>}
            </div>
          </div>
          <CheckCircle2 className="h-3 w-3 text-success flex-shrink-0" />
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) upload(f); }}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "rounded border border-dashed border-warning/40 px-3 py-2 text-center text-[11px] cursor-pointer hover:bg-warning/10 transition-colors",
          busy && "opacity-50 pointer-events-none",
        )}
      >
        <input ref={fileRef} type="file" accept=".ps1,.sh,.py,.bat,.vbs,.exe,.bin,.dll,.raw,.b64,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        {busy ? (
          <div className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Uploading…</div>
        ) : (
          <>
            <Upload className="h-4 w-4 mx-auto mb-1 text-warning" />
            <div className="font-medium">{meta ? "Replace payload" : "Drop payload script or binary"}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">max 8 MB · .ps1 .sh .py .bat .vbs .exe .bin .dll .raw .b64 .txt</div>
          </>
        )}
      </div>

      {error && (
        <div className="rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger inline-flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5" /> {error}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        The platform never executes payload bytes — it stores them by SHA-256 so a future runner can deliver them to the listener target.
      </p>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
