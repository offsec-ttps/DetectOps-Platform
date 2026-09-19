"use client";

import { useState } from "react";
import { Save, Loader2, X, AlertTriangle, CheckCircle2, Zap, Eye, EyeOff, Terminal, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export type McpTransport = "stdio" | "http";

interface Draft {
  id?: string;
  label: string;
  transport: McpTransport;
  address: string;
  token: string;            // plaintext for create/update; UI never holds the stored ciphertext
  hasToken?: boolean;
  enabled: boolean;
}

interface TestOutcome {
  ok: boolean;
  latency: number;
  message: string;
  toolCount: number;
}

interface Props {
  draft: Draft;
  onSaved: () => void;
  onCancel: () => void;
}

const TRANSPORT_META: Record<McpTransport, { label: string; Icon: React.ComponentType<{ className?: string }>; placeholder: string; hint: string }> = {
  http:  { label: "HTTP", Icon: Globe,    placeholder: "https://mcp.example.com/mcp", hint: "Streamable-HTTP MCP endpoint URL." },
  stdio: { label: "Stdio", Icon: Terminal, placeholder: "/usr/local/bin/mcp-server --flag", hint: "Full command line — the platform spawns this process and speaks MCP over its stdin/stdout." },
};

export default function McpServerForm({ draft, onSaved, onCancel }: Props) {
  const [data, setData] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const update = (patch: Partial<Draft>) => setData({ ...data, ...patch });
  const meta = TRANSPORT_META[data.transport];

  const testSaved = async () => {
    if (!data.id) return;
    setTesting(true); setError(null); setTest(null);
    try {
      const res = await fetch(`/api/mcp/servers/${data.id}/test`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "test failed"); return; }
      setTest(j);
    } finally { setTesting(false); }
  };

  const save = async () => {
    setError(null); setSaving(true);
    try {
      const payload: Record<string, unknown> = { label: data.label, transport: data.transport, address: data.address, enabled: data.enabled };
      if (data.token) payload.token = data.token;

      const isUpdate = !!data.id;
      const url = isUpdate ? `/api/mcp/servers/${data.id}` : "/api/mcp/servers";
      const res = await fetch(url, { method: isUpdate ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
        <h3 className="text-sm font-semibold text-foreground">{data.id ? "Edit MCP server" : "New MCP server"}</h3>
        <div className="ml-auto inline-flex items-center gap-2">
          <button onClick={onCancel} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Cancel
          </button>
          <button onClick={save} disabled={saving || !data.label.trim() || !data.address.trim()} className="inline-flex items-center gap-1.5 text-[11px] h-7 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save server
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 border-b border-danger/30 bg-danger/10 text-[11px] text-danger inline-flex items-center gap-2 w-full">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <div className="p-4 space-y-3">
        <Field label="Transport">
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(TRANSPORT_META) as McpTransport[]).map((t) => {
              const tm = TRANSPORT_META[t];
              const sel = data.transport === t;
              return (
                <button key={t} onClick={() => update({ transport: t })} className={cn(
                  "text-left rounded-md border px-3 py-2 transition-colors",
                  sel ? "border-accent bg-accent/10 text-foreground" : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-accent/40",
                )}>
                  <div className="inline-flex items-center gap-1.5">
                    <tm.Icon className={cn("h-3.5 w-3.5", sel ? "text-accent" : "text-muted-foreground")} />
                    <span className="text-xs font-semibold">{tm.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Label" required>
          <input type="text" value={data.label} onChange={(e) => update({ label: e.target.value })}
            placeholder="e.g. VirusTotal"
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </Field>

        <Field label={data.transport === "http" ? "Endpoint URL" : "Command"} required>
          <input type="text" value={data.address} onChange={(e) => update({ address: e.target.value })}
            placeholder={meta.placeholder}
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
          <p className="text-[10px] text-muted-foreground mt-0.5">{meta.hint}</p>
        </Field>

        {data.transport === "http" && (
          <Field label="Auth token (optional)">
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={data.token}
                onChange={(e) => update({ token: e.target.value })}
                placeholder={data.hasToken ? "Stored — leave blank to keep existing" : "Paste plaintext token — encrypted at rest"}
                className="w-full px-2 py-1 pr-8 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
              />
              <button onClick={() => setShowToken(!showToken)} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground" type="button">
                {showToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Sent as <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>. Stored encrypted via <code className="font-mono">CREDENTIAL_VAULT_KEY</code>, never returned in responses.
            </p>
          </Field>
        )}

        <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
          <input type="checkbox" checked={data.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="accent-accent" />
          enabled
        </label>

        {/* Test panel */}
        <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs font-semibold text-foreground">Connectivity test</span>
            <button onClick={testSaved} disabled={testing || !data.id} title={data.id ? undefined : "Save first to test"}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2 text-[11px] rounded bg-info text-white hover:opacity-90 disabled:opacity-50">
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Test
            </button>
          </div>
          {test && (
            <div className={cn(
              "rounded border px-3 py-2 text-[11px] space-y-1",
              test.ok ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger",
            )}>
              <div className="inline-flex items-center gap-1 font-semibold">
                {test.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {test.ok ? "OK" : "Failed"} · {test.latency}ms · {test.toolCount} tool(s)
              </div>
              <div className="text-foreground">{test.message}</div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Actually connects and runs <code className="font-mono">tools/list</code> against the server — real proof it's reachable, not just a well-formed URL.
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
