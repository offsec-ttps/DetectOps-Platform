"use client";

import { useEffect, useState } from "react";
import {
  Plus, Loader2, Edit2, Trash2, Zap, CheckCircle2, AlertTriangle, RefreshCw, Inbox,
  Power, Plug, Globe, Terminal, Key,
} from "lucide-react";
import { cn } from "@/lib/utils";
import McpServerForm, { type McpTransport } from "@/components/mcp-servers/McpServerForm";

interface Row {
  id: string;
  label: string;
  transport: McpTransport;
  address: string;
  hasToken: boolean;
  tokenMasked: string;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean;
  lastTestLatency: number;
  lastTestMessage: string;
  lastToolCount: number;
  createdAt: string;
}

interface EnvRow { name: string; transport: McpTransport; address: string; hasToken: boolean }

const TRANSPORT_ICON: Record<McpTransport, React.ComponentType<{ className?: string }>> = { http: Globe, stdio: Terminal };

function newDraft(): Row & { token: string } {
  return {
    id: "" as any,
    label: "", transport: "http", address: "", token: "",
    hasToken: false, tokenMasked: "",
    enabled: true,
    lastTestedAt: null, lastTestOk: false, lastTestLatency: 0, lastTestMessage: "", lastToolCount: 0,
    createdAt: "",
  };
}

export default function McpServersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [envServers, setEnvServers] = useState<EnvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/mcp/servers"),
        fetch("/api/llm-providers"),
      ]);
      const ja = await a.json(); const jb = await b.json();
      if (!a.ok) { setError(ja.error || "load failed"); return; }
      setRows(ja.items || []);
      if (b.ok) setEnvServers(jb.mcpServers || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const test = async (id: string) => {
    setTestingId(id);
    try {
      const r = await fetch(`/api/mcp/servers/${id}/test`, { method: "POST" });
      const j = await r.json();
      alert(`${j.ok ? "✓ OK" : "✗ Failed"} · ${j.latency}ms · ${j.toolCount} tool(s) · ${j.message}`);
      await load();
    } finally { setTestingId(null); }
  };
  const toggleEnabled = async (row: Row) => {
    await fetch(`/api/mcp/servers/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !row.enabled }) });
    await load();
  };
  const remove = async (row: Row) => {
    if (!confirm(`Delete MCP server "${row.label}"?`)) return;
    await fetch(`/api/mcp/servers/${row.id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Plug className="h-6 w-6 text-accent" />
            MCP Servers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect other Model Context Protocol servers (VirusTotal, MISP, internal tools) so the platform can
            fetch real data from them during detection-pack generation. Test connectivity before saving.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button onClick={load} className="inline-flex items-center gap-1 text-[11px] h-8 px-2 rounded border border-border text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
          <button onClick={() => { setCreating(true); setEditing(null); }} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]">
            <Plus className="h-3.5 w-3.5" /> Add server
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}

      {creating && (
        <McpServerForm draft={newDraft()} onSaved={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
      )}
      {editing && (
        <McpServerForm draft={{ ...editing, token: "" }} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No MCP servers configured</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Add a server to enrich detection-pack generation with real data from other MCP servers.
            The platform also falls back to the <code className="font-mono">MCP_SERVERS</code> env var (see below).
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const Icon = TRANSPORT_ICON[r.transport];
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-3">
                  <Icon className="h-5 w-5 mt-0.5 flex-shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground truncate">{r.label}</h3>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border border-accent/40 bg-accent/10 text-accent">{r.transport}</span>
                      {!r.enabled && <span className="rounded px-1.5 py-0.5 text-[10px] uppercase bg-muted/15 text-muted-foreground">disabled</span>}
                      {r.hasToken && <span className="text-[10px] text-success inline-flex items-center gap-0.5"><Key className="h-2.5 w-2.5" /> token stored</span>}
                      {r.lastTestedAt && (
                        <span className={cn("text-[10px] inline-flex items-center gap-0.5", r.lastTestOk ? "text-success" : "text-danger")}>
                          {r.lastTestOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                          last test: {r.lastTestOk ? `ok · ${r.lastToolCount} tools` : "fail"} · {r.lastTestLatency}ms
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                      <span className="font-mono">{r.address}</span>
                    </div>
                    {r.lastTestMessage && (
                      <div className={cn("mt-1 text-[10px]", r.lastTestOk ? "text-muted-foreground" : "text-danger")} title={r.lastTestMessage}>
                        {r.lastTestMessage.slice(0, 160)}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => test(r.id)} disabled={testingId === r.id} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
                      {testingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Test
                    </button>
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
      {envServers.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden mt-6">
          <div className="px-4 py-2 border-b border-border flex items-center gap-2">
            <Plug className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold text-foreground">Env-var fallback registry</h3>
            <span className="text-[10px] text-muted-foreground">Read-only — from MCP_SERVERS. Managed servers above override these by name.</span>
          </div>
          <div className="divide-y divide-border">
            {envServers.map((s) => (
              <div key={s.name} className="px-4 py-2 flex items-center gap-2 text-[11px]">
                <span className="font-mono w-32 text-foreground truncate">{s.name}</span>
                <span className="uppercase font-bold text-[9px] text-muted-foreground">{s.transport}</span>
                <span className="font-mono text-muted-foreground truncate">{s.address}</span>
                {s.hasToken && <span className="text-[9px] text-success ml-auto">token set</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
