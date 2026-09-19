"use client";

import { useEffect, useState } from "react";
import {
  Save, Loader2, X, AlertTriangle, CheckCircle2, Zap, Key, Eye, EyeOff,
  Sparkles, Box, Globe, Cpu, Server, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ProviderKind =
  | "anthropic" | "openai" | "openrouter" | "nvidia" | "ollama"
  | "openai-compatible" | "custom";

interface Draft {
  id?: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;                          // plaintext for create; UI never holds the stored ciphertext
  apiKeyMasked?: string;                   // shows "••••" when an existing key is on file
  hasApiKey?: boolean;
  defaultModel: string;
  authHeaderName: string;
  authHeaderValue: string;
  modelsPath: string;
  enabled: boolean;
  isDefault: boolean;
}

interface TestOutcome {
  ok: boolean;
  latencyMs: number;
  message: string;
  details?: { modelUsed?: string; sampleResponse?: string; endpointUsed?: string };
}

interface Props {
  draft: Draft;
  onSaved: () => void;
  onCancel: () => void;
}

const KIND_META: Record<ProviderKind, { label: string; Icon: React.ComponentType<{ className?: string }>; blurb: string; defaultModelExample: string; defaultBaseUrl: string }> = {
  anthropic:           { label: "Anthropic Claude",      Icon: Sparkles, blurb: "Claude Opus / Sonnet / Haiku. Uses x-api-key header.", defaultModelExample: "claude-haiku-4-5-20251001", defaultBaseUrl: "https://api.anthropic.com" },
  openai:              { label: "OpenAI",                Icon: Box,      blurb: "GPT models via api.openai.com. Standard Bearer auth.",   defaultModelExample: "gpt-4o-mini",              defaultBaseUrl: "https://api.openai.com/v1" },
  openrouter:          { label: "OpenRouter",            Icon: Globe,    blurb: "300+ models from many vendors. OpenAI-compatible API.", defaultModelExample: "openai/gpt-4o-mini",       defaultBaseUrl: "https://openrouter.ai/api/v1" },
  nvidia:              { label: "NVIDIA NIM",            Icon: Cpu,      blurb: "Llama / Mistral / Nemotron via integrate.api.nvidia.com.", defaultModelExample: "meta/llama-3.1-8b-instruct", defaultBaseUrl: "https://integrate.api.nvidia.com/v1" },
  ollama:              { label: "Ollama (local)",        Icon: Server,   blurb: "Local Ollama daemon. No API key required.",              defaultModelExample: "llama3.2",                 defaultBaseUrl: "http://localhost:11434" },
  "openai-compatible": { label: "OpenAI-compatible",     Icon: Box,      blurb: "Any /v1/chat/completions endpoint (vLLM, LM Studio, etc).", defaultModelExample: "llama-3.1-8b",            defaultBaseUrl: "" },
  custom:              { label: "Custom endpoint",       Icon: Key,      blurb: "Configure auth header style, base URL, and models path manually.", defaultModelExample: "my-model",          defaultBaseUrl: "" },
};

export default function ProviderForm({ draft, onSaved, onCancel }: Props) {
  const [data, setData] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; label?: string; context?: number }>>([]);
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const update = (patch: Partial<Draft>) => setData({ ...data, ...patch });

  const meta = KIND_META[data.kind];

  useEffect(() => {
    // When kind changes on a new draft, pre-fill the baseUrl with the default
    if (!data.id && !data.baseUrl) update({ baseUrl: meta.defaultBaseUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.kind]);

  const testUnsaved = async () => {
    setTesting(true); setError(null); setTest(null);
    try {
      const res = await fetch("/api/llm-providers/configs/test-unsaved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: data.kind,
          baseUrl: data.baseUrl || undefined,
          apiKey: data.apiKey || undefined,
          defaultModel: data.defaultModel || undefined,
          authHeaderName: data.authHeaderName,
          authHeaderValue: data.authHeaderValue,
          modelsPath: data.modelsPath || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "test failed"); return; }
      setTest(j);
    } catch (err: any) { setError(err?.message || "test failed"); }
    finally { setTesting(false); }
  };

  const testSaved = async () => {
    if (!data.id) return testUnsaved();
    setTesting(true); setError(null); setTest(null);
    try {
      const res = await fetch(`/api/llm-providers/configs/${data.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testModel: data.defaultModel || undefined }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "test failed"); return; }
      setTest(j);
    } finally { setTesting(false); }
  };

  const fetchModels = async () => {
    setLoadingModels(true); setError(null);
    try {
      if (data.id) {
        const res = await fetch(`/api/llm-providers/configs/${data.id}/models`);
        const j = await res.json();
        if (!res.ok) { setError(j.error || "list models failed"); return; }
        setModels(j.models || []);
      } else {
        // For unsaved drafts, hit the testConnection /listModels path via test-unsaved
        // (We use a tiny POST endpoint shape — fall back to inline fetch if we add one later.)
        setError("Save the config first to fetch the live model list.");
      }
    } finally { setLoadingModels(false); }
  };

  const save = async () => {
    setError(null); setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        label: data.label,
        kind: data.kind,
        baseUrl: data.baseUrl,
        defaultModel: data.defaultModel,
        authHeaderName: data.authHeaderName,
        authHeaderValue: data.authHeaderValue,
        modelsPath: data.modelsPath,
        enabled: data.enabled,
        isDefault: data.isDefault,
      };
      if (data.apiKey && data.apiKey !== data.apiKeyMasked) payload.apiKey = data.apiKey;

      const isUpdate = !!data.id;
      const url = isUpdate ? `/api/llm-providers/configs/${data.id}` : "/api/llm-providers/configs";
      const res = await fetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "save failed"); return; }
      onSaved();
    } catch (err: any) { setError(err?.message || "save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <meta.Icon className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">
          {data.id ? "Edit LLM provider" : "New LLM provider"}
        </h3>
        <div className="ml-auto inline-flex items-center gap-2">
          <button onClick={onCancel} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Cancel
          </button>
          <button onClick={save} disabled={saving || !data.label.trim()} className="inline-flex items-center gap-1.5 text-[11px] h-7 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save provider
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 border-b border-danger/30 bg-danger/10 text-[11px] text-danger inline-flex items-center gap-2 w-full">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <div className="p-4 space-y-3">
        {!data.id && (
          <Field label="Provider kind">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {(Object.keys(KIND_META) as ProviderKind[]).map((k) => {
                const km = KIND_META[k];
                const sel = data.kind === k;
                return (
                  <button key={k} onClick={() => update({ kind: k })} className={cn(
                    "text-left rounded-md border px-3 py-2 transition-colors",
                    sel ? "border-accent bg-accent/10 text-foreground" : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-accent/40",
                  )}>
                    <div className="inline-flex items-center gap-1.5">
                      <km.Icon className={cn("h-3.5 w-3.5", sel ? "text-accent" : "text-muted-foreground")} />
                      <span className="text-xs font-semibold">{km.label}</span>
                    </div>
                    <div className="text-[10px] mt-0.5 leading-snug">{km.blurb}</div>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Label" required>
          <input type="text" value={data.label} onChange={(e) => update({ label: e.target.value })}
            placeholder="e.g. Anthropic prod key"
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </Field>

        <Field label="Base URL">
          <input type="text" value={data.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })}
            placeholder={meta.defaultBaseUrl || "https://api.example.com/v1"}
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
          <p className="text-[10px] text-muted-foreground mt-0.5">Leave blank to use the provider's default endpoint.</p>
        </Field>

        {data.kind !== "ollama" && (
          <Field label="API key">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={data.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder={data.hasApiKey ? "Stored — leave blank to keep existing" : "Paste plaintext key — encrypted at rest"}
                className="w-full px-2 py-1 pr-8 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
              />
              <button onClick={() => setShowKey(!showKey)} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground" type="button">
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Stored encrypted via <code>CREDENTIAL_VAULT_KEY</code>. Never logged or returned in responses.
            </p>
          </Field>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Field label="Default model">
            <div className="flex gap-1">
              <input type="text" value={data.defaultModel} onChange={(e) => update({ defaultModel: e.target.value })}
                placeholder={meta.defaultModelExample}
                className="flex-1 px-2 py-1 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              <button onClick={fetchModels} disabled={loadingModels || !data.id}
                className="inline-flex items-center gap-1 h-7 px-2 text-[10px] rounded border border-info/40 text-info hover:bg-info/10 disabled:opacity-50"
                title={data.id ? "Fetch live model list from this provider" : "Save first to fetch the live model list"}>
                {loadingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                List
              </button>
            </div>
            {models.length > 0 && (
              <select
                onChange={(e) => update({ defaultModel: e.target.value })}
                value={data.defaultModel}
                className="mt-1 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
              >
                <option value="">— pick a model —</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label || m.id}{m.context ? ` · ${m.context}t` : ""}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Models endpoint (custom only)">
            <input type="text" value={data.modelsPath} onChange={(e) => update({ modelsPath: e.target.value })}
              placeholder="/v1/models"
              disabled={data.kind !== "custom"}
              className="w-full px-2 py-1 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent disabled:opacity-50" />
          </Field>
        </div>

        {data.kind === "custom" && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-warning font-semibold inline-flex items-center gap-1.5">
              <Key className="h-3 w-3" /> Custom auth header
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Field label="Header name">
                <input type="text" value={data.authHeaderName} onChange={(e) => update({ authHeaderName: e.target.value })}
                  placeholder="Authorization"
                  className="w-full px-2 py-1 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              </Field>
              <Field label="Header value template (2-col span)">
                <input type="text" value={data.authHeaderValue} onChange={(e) => update({ authHeaderValue: e.target.value })}
                  placeholder="Bearer {{key}}"
                  className="w-full px-2 py-1 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              </Field>
            </div>
            <p className="text-[10px] text-muted-foreground">
              <code className="font-mono">{`{{key}}`}</code> is replaced with the saved API key at request time.
              Example for X-API-Key header: <code className="font-mono">{`X-API-Key`}</code> + <code className="font-mono">{`{{key}}`}</code>.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
            <input type="checkbox" checked={data.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="accent-accent" />
            enabled
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
            <input type="checkbox" checked={data.isDefault} onChange={(e) => update({ isDefault: e.target.checked })} className="accent-accent" />
            set as default for this kind
          </label>
        </div>

        {/* Test panel */}
        <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs font-semibold text-foreground">Connectivity test</span>
            <button onClick={data.id ? testSaved : testUnsaved} disabled={testing} className="ml-auto inline-flex items-center gap-1 h-7 px-2 text-[11px] rounded bg-info text-white hover:opacity-90 disabled:opacity-50">
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              {data.id ? "Test stored" : "Test (unsaved)"}
            </button>
          </div>
          {test && (
            <div className={cn(
              "rounded border px-3 py-2 text-[11px] space-y-1",
              test.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger",
            )}>
              <div className="inline-flex items-center gap-1 font-semibold">
                {test.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {test.ok ? "OK" : "Failed"} · {test.latencyMs}ms
              </div>
              <div className="text-foreground">{test.message}</div>
              {test.details?.modelUsed && <div className="text-[10px] text-muted-foreground font-mono">model: {test.details.modelUsed}</div>}
              {test.details?.endpointUsed && <div className="text-[10px] text-muted-foreground font-mono">endpoint: {test.details.endpointUsed}</div>}
              {test.details?.sampleResponse && <div className="text-[10px] text-muted-foreground">sample: "{test.details.sampleResponse}"</div>}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            For unsaved drafts, the test uses the values currently in this form (key sent server-side, never persisted, never logged in detail).
          </p>
        </div>
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
