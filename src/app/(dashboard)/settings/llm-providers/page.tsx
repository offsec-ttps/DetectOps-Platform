"use client";

import { useEffect, useState } from "react";
import {
  Plus, Loader2, Edit2, Trash2, Zap, CheckCircle2, AlertTriangle, RefreshCw, Inbox,
  Sparkles, Box, Globe, Cpu, Server, Key, Star, Power, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ProviderForm, { type ProviderKind } from "@/components/llm-providers/ProviderForm";

interface Config {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  defaultModel: string;
  authHeaderName: string;
  authHeaderValue: string;
  modelsPath: string;
  enabled: boolean;
  isDefault: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean;
  lastTestLatency: number;
  lastTestMessage: string;
  createdAt: string;
}

interface EnvRow {
  id: string;
  label: string;
  configured: boolean;
  defaultModel: string;
  envVarHints: string[];
  baseUrl?: string;
}

const KIND_META: Record<ProviderKind, { label: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  anthropic:           { label: "Anthropic",          Icon: Sparkles, color: "text-accent border-accent/40 bg-accent/10" },
  openai:              { label: "OpenAI",             Icon: Box,      color: "text-success border-success/40 bg-success/10" },
  openrouter:          { label: "OpenRouter",         Icon: Globe,    color: "text-info border-info/40 bg-info/10" },
  nvidia:              { label: "NVIDIA NIM",         Icon: Cpu,      color: "text-warning border-warning/40 bg-warning/10" },
  ollama:              { label: "Ollama",             Icon: Server,   color: "text-muted-foreground border-border bg-muted/10" },
  "openai-compatible": { label: "OpenAI-compatible",  Icon: Box,      color: "text-info border-info/40 bg-info/10" },
  custom:              { label: "Custom",             Icon: Key,      color: "text-warning border-warning/40 bg-warning/10" },
};

function newDraft(kind: ProviderKind = "anthropic"): Config {
  return {
    id: "" as any,
    label: "", kind, baseUrl: "",
    hasApiKey: false, apiKeyMasked: "", defaultModel: "",
    authHeaderName: "Authorization", authHeaderValue: "Bearer {{key}}",
    modelsPath: "",
    enabled: true, isDefault: false,
    lastTestedAt: null, lastTestOk: false, lastTestLatency: 0, lastTestMessage: "",
    createdAt: "",
  };
}

export default function LlmProvidersPage() {
  const [rows, setRows] = useState<Config[]>([]);
  const [envFallback, setEnvFallback] = useState<{ defaultProvider: string; providers: EnvRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<ProviderKind | null>(null);
  const [editing, setEditing] = useState<Config | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [createMenu, setCreateMenu] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/llm-providers/configs"),
        fetch("/api/llm-providers"),
      ]);
      const ja = await a.json(); const jb = await b.json();
      if (!a.ok) { setError(ja.error || "load failed"); return; }
      setRows(ja.items || []);
      if (b.ok) setEnvFallback(jb);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const test = async (id: string) => {
    setTestingId(id);
    try {
      const r = await fetch(`/api/llm-providers/configs/${id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const j = await r.json();
      alert(`${j.ok ? "✓ OK" : "✗ Failed"} · ${j.latencyMs}ms · ${j.message}`);
      await load();
    } finally { setTestingId(null); }
  };
  const toggleEnabled = async (row: Config) => {
    await fetch(`/api/llm-providers/configs/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !row.enabled }) });
    await load();
  };
  const setDefault = async (row: Config) => {
    await fetch(`/api/llm-providers/configs/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isDefault: true }) });
    await load();
  };
  const remove = async (row: Config) => {
    if (!confirm(`Delete provider "${row.label}"?`)) return;
    await fetch(`/api/llm-providers/configs/${row.id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-accent" />
            LLM Providers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add API keys for Anthropic / OpenAI / OpenRouter / NVIDIA / Ollama and OpenAI-compatible vendors.
            Or configure a fully custom endpoint with your own auth header template. Test connectivity before saving.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button onClick={load} className="inline-flex items-center gap-1 text-[11px] h-8 px-2 rounded border border-border text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
          <div className="relative">
            <button onClick={() => setCreateMenu(!createMenu)} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]">
              <Plus className="h-3.5 w-3.5" /> Add provider
            </button>
            {createMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCreateMenu(false)} />
                <div className="absolute right-0 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
                  {(Object.keys(KIND_META) as ProviderKind[]).map((k) => {
                    const m = KIND_META[k];
                    return (
                      <button key={k} onClick={() => { setCreating(k); setEditing(null); setCreateMenu(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-card-hover border-b border-border last:border-0 flex items-start gap-2">
                        <m.Icon className={cn("h-4 w-4 mt-0.5", m.color.split(" ")[0])} />
                        <div className="text-xs font-semibold text-foreground">{m.label}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}

      {creating && (
        <ProviderForm draft={newDraft(creating) as any} onSaved={() => { setCreating(null); load(); }} onCancel={() => setCreating(null)} />
      )}
      {editing && (
        <ProviderForm draft={editing as any} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No LLM providers configured</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Add a provider to unlock LLM-backed features (Detection Pack auto-generation, IRP synthesis, etc.).
            The platform falls back to env-var configured providers (see below) and deterministic generators otherwise.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const meta = KIND_META[r.kind];
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-3">
                  <meta.Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", meta.color.split(" ")[0])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground truncate">{r.label}</h3>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", meta.color)}>{meta.label}</span>
                      {r.isDefault && <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border border-accent/40 bg-accent/10 text-accent"><Star className="h-2.5 w-2.5" /> default</span>}
                      {!r.enabled && <span className="rounded px-1.5 py-0.5 text-[10px] uppercase bg-muted/15 text-muted-foreground">disabled</span>}
                      {r.hasApiKey ? <span className="text-[10px] text-success inline-flex items-center gap-0.5"><Key className="h-2.5 w-2.5" /> key stored</span> : r.kind !== "ollama" && <span className="text-[10px] text-warning inline-flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" /> no key</span>}
                      {r.lastTestedAt && (
                        <span className={cn("text-[10px] inline-flex items-center gap-0.5", r.lastTestOk ? "text-success" : "text-danger")}>
                          {r.lastTestOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                          last test: {r.lastTestOk ? "ok" : "fail"} · {r.lastTestLatency}ms
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                      <span className="font-mono">model: <span className="text-foreground">{r.defaultModel || "(provider default)"}</span></span>
                      {r.baseUrl && <span className="font-mono">baseUrl: <span className="text-foreground">{r.baseUrl}</span></span>}
                      {r.kind === "custom" && r.authHeaderName !== "Authorization" && <span className="font-mono">header: <span className="text-foreground">{r.authHeaderName}</span></span>}
                    </div>
                    {r.lastTestMessage && (
                      <div className={cn("mt-1 text-[10px]", r.lastTestOk ? "text-muted-foreground" : "text-danger")} title={r.lastTestMessage}>
                        {r.lastTestMessage.slice(0, 120)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => test(r.id)} disabled={testingId === r.id} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
                      {testingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Test
                    </button>
                    {!r.isDefault && (
                      <button onClick={() => setDefault(r)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground" title="Mark as default for this kind">
                        <Star className="h-3 w-3" /> Default
                      </button>
                    )}
                    <button onClick={() => toggleEnabled(r)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
                      <Power className="h-3 w-3" /> {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
                      <Edit2 className="h-3 w-3" /> Edit
                    </button>
                    <button onClick={() => remove(r)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded text-danger hover:bg-danger/10">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Env-var fallback summary */}
      {envFallback?.providers && envFallback.providers.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden mt-6">
          <div className="px-4 py-2 border-b border-border flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-foreground">Env-var fallback registry</h3>
            <span className="text-[10px] text-muted-foreground">Read-only — DB configs above override these for the same kind.</span>
          </div>
          <div className="divide-y divide-border">
            {envFallback.providers.map((p) => (
              <div key={p.id} className="px-4 py-2 flex items-center gap-2 text-[11px]">
                <span className="font-mono w-24 text-foreground">{p.label}</span>
                {p.configured ? <CheckCircle2 className="h-3 w-3 text-success" /> : <AlertTriangle className="h-3 w-3 text-warning" />}
                <span className={cn("uppercase font-bold text-[9px]", p.configured ? "text-success" : "text-warning")}>{p.configured ? "configured" : "unset"}</span>
                <span className="font-mono text-muted-foreground">model={p.defaultModel}</span>
                <span className="text-[9px] text-muted-foreground ml-auto">env: {p.envVarHints.join(", ")}</span>
              </div>
            ))}
            <div className="px-4 py-1.5 text-[10px] text-muted-foreground">
              Resolved default for env-fallback dispatcher: <span className="font-mono text-foreground">{envFallback.defaultProvider}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
