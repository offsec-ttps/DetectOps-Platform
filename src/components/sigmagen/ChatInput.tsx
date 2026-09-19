"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, X, Globe, FileText, Cpu } from "lucide-react";

export interface SendPayload {
  text?: string;
  file?: File;
  enableRetrieval: boolean;
  provider?: string;
}

interface ProviderOpt { id: string; label: string; configured: boolean }

export function ChatInput({ onSend, disabled }: { onSend: (p: SendPayload) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [retrieval, setRetrieval] = useState(true);
  const [providers, setProviders] = useState<ProviderOpt[]>([]);
  const [provider, setProvider] = useState<string>("");   // "" = use app default
  const fileRef = useRef<HTMLInputElement>(null);

  // Load configured providers so the SigmaGen module can override per-run.
  useEffect(() => {
    fetch("/api/llm-providers").then((r) => r.json()).then((d) => {
      const list: ProviderOpt[] = (d.providers || []).map((p: any) => ({ id: p.id, label: p.label, configured: p.configured }));
      setProviders(list.filter((p) => p.configured));
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("sigmagen.provider") || "" : "";
      if (saved) setProvider(saved);
    }).catch(() => {});
  }, []);

  const canSend = !disabled && (file || text.trim().length > 0);
  const isUrl = /^https?:\/\/\S+$/i.test(text.trim());

  const submit = () => {
    if (!canSend) return;
    onSend({ text: file ? undefined : text.trim(), file: file || undefined, enableRetrieval: retrieval, provider: provider || undefined });
    setText("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const pickProvider = (id: string) => {
    setProvider(id);
    if (typeof window !== "undefined") window.localStorage.setItem("sigmagen.provider", id);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-card-hover px-2.5 py-1.5 text-xs">
          <FileText className="h-3.5 w-3.5 text-accent" />
          <span className="flex-1 truncate text-foreground">{file.name}</span>
          <span className="text-muted">{(file.size / 1024).toFixed(0)} KB</span>
          <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-muted hover:text-danger"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        disabled={disabled || !!file}
        placeholder={file ? "File staged — press Send to analyse it." : "Paste a threat-report URL, IOCs, or describe a threat…  (⌘/Ctrl+Enter to send)"}
        className="w-full resize-none bg-transparent px-1 text-sm text-foreground placeholder:text-muted focus:outline-none disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf,text/plain" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button onClick={() => fileRef.current?.click()} disabled={disabled}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
            <Paperclip className="h-3.5 w-3.5" /> Attach PDF / DOCX / TXT
          </button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={retrieval} onChange={(e) => setRetrieval(e.target.checked)} className="rounded border-border" />
            <Globe className="h-3.5 w-3.5" /> Pull related intel
          </label>
          {providers.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Override the LLM provider for SigmaGen runs">
              <Cpu className="h-3.5 w-3.5" />
              <select value={provider} onChange={(e) => pickProvider(e.target.value)} disabled={disabled}
                className="h-7 rounded border border-border bg-input px-1.5 text-[11px] text-foreground focus:outline-none">
                <option value="">App default</option>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          )}
          {isUrl && !file && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">URL detected</span>}
        </div>
        <Button size="sm" onClick={submit} disabled={!canSend} icon={<Send className="h-3.5 w-3.5" />}>Send</Button>
      </div>
    </div>
  );
}
