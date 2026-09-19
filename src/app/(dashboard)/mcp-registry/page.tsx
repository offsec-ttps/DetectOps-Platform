"use client";

import React, { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Blocks, RefreshCw, Plus } from "lucide-react";

interface StatsResp {
  enabled: boolean;
  server: { name: string; version: string; title?: string };
  endpoint: string;
  tools: { name: string; description: string; scope: string }[];
  toolCount: number;
  activeKeys: number;
  calls24h: number;
  content: { detections: { total: number }; threatIntel: { reports: number; indicators: number } };
}
interface KeyRow {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  tier: string;
  rateLimitPerMin: number;
  dailyQuota: number;
  requestCount: number;
  dailyCount: number;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function MCPRegistryPage() {
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState("free");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, k] = await Promise.all([
        fetch("/api/mcp/stats").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/mcp/keys").then((r) => (r.ok ? r.json() : { items: [] })),
      ]);
      setStats(s);
      setKeys(k.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function mint() {
    setMinting(true);
    setNewKey(null);
    try {
      const r = await fetch("/api/mcp/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label || "MCP key", tier }),
      });
      const j = await r.json();
      if (j.key) setNewKey(j.key);
      setLabel("");
      await load();
    } finally {
      setMinting(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/mcp/keys/${id}`, { method: "DELETE" });
    await load();
  }

  function copy(text: string, tag: string) {
    navigator.clipboard?.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(""), 1500);
  }

  const endpoint = stats?.endpoint || "http://localhost:3000/api/mcp";
  const curlSnippet = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer dmcp_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;
  const clientSnippet = JSON.stringify(
    { mcpServers: { "detectops-detections": { type: "streamable-http", url: endpoint, headers: { Authorization: "Bearer dmcp_YOUR_KEY" } } } },
    null,
    2,
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">MCP Server</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Detection-content Model Context Protocol server — expose {stats?.content?.detections?.total?.toLocaleString() ?? "14k+"} detection rules, IOCs, and threat intel to any MCP client via issued API keys.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Server", value: stats ? (stats.enabled ? "Online" : "Disabled") : "—", color: stats?.enabled ? "text-success" : "text-muted-foreground" },
          { label: "Active Keys", value: String(stats?.activeKeys ?? 0), color: "text-foreground" },
          { label: "Tools Available", value: String(stats?.toolCount ?? 0), color: "text-accent" },
          { label: "Tool Calls (24h)", value: String(stats?.calls24h ?? 0), color: "text-purple" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-semibold text-muted uppercase">{s.label}</p>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Connection */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Endpoint</h2>
          <code className="rounded bg-background px-2 py-1 text-xs text-accent">{endpoint}</code>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Snippet title="MCP client config (mcp.json / Claude Desktop)" text={clientSnippet} onCopy={() => copy(clientSnippet, "client")} copied={copied === "client"} />
          <Snippet title="curl (tools/list)" text={curlSnippet} onCopy={() => copy(curlSnippet, "curl")} copied={copied === "curl"} />
        </div>
      </div>

      {/* API Keys */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">API Keys</h2>
        {newKey && (
          <div className="mt-3 rounded-lg border border-success/40 bg-success/10 p-3">
            <p className="text-xs font-semibold text-success">Key created — copy it now, it will not be shown again:</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-background px-2 py-1 text-xs text-foreground">{newKey}</code>
              <button onClick={() => copy(newKey, "new")} className="rounded border border-border px-2 py-1 text-xs hover:bg-card-hover">{copied === "new" ? "Copied" : "Copy"}</button>
            </div>
          </div>
        )}
        {/* Mint form */}
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[10px] font-semibold text-muted uppercase">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. research-bot" className="mt-1 h-9 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted uppercase">Tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="mt-1 h-9 rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-input-focus focus:outline-none">
              <option value="free">free (60/min · 200/day)</option>
              <option value="pro">pro (240/min · 10k/day)</option>
              <option value="admin">admin (all scopes)</option>
            </select>
          </div>
          <button onClick={mint} disabled={minting} className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50">
            <Plus className="h-4 w-4" /> {minting ? "Minting…" : "Mint Key"}
          </button>
        </div>
        {/* Keys table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-semibold">Key</th>
                <th className="py-2 pr-4 font-semibold">Label</th>
                <th className="py-2 pr-4 font-semibold">Tier</th>
                <th className="py-2 pr-4 font-semibold">Scopes</th>
                <th className="py-2 pr-4 font-semibold">Usage</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No keys yet — mint one above.</td></tr>
              )}
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-border/50">
                  <td className="py-2 pr-4"><code className="text-accent">dmcp_{k.prefix}…</code></td>
                  <td className="py-2 pr-4 text-foreground">{k.label || "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{k.tier}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{k.scopes.join(", ")}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{k.requestCount} calls · {k.dailyCount}/{k.dailyQuota} today</td>
                  <td className="py-2 pr-4">{k.enabled ? <span className="text-success">active</span> : <span className="text-muted">revoked</span>}</td>
                  <td className="py-2">{k.enabled && <button onClick={() => revoke(k.id)} className="rounded border border-danger/40 px-2 py-0.5 text-danger hover:bg-danger/10">Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tools */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Blocks className="h-4 w-4 text-accent" /> Tools ({stats?.toolCount ?? 0})</h2>
        <div className="grid grid-cols-2 gap-3">
          {(stats?.tools || []).map((t) => (
            <div key={t.name} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between">
                <code className="text-xs font-semibold text-accent">{t.name}</code>
                <span className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted">{t.scope}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
            </div>
          ))}
        </div>
        {!stats && !loading && (
          <div className="flex flex-col items-center justify-center py-10">
            <Blocks className="mb-3 h-10 w-10 text-muted" />
            <p className="text-sm text-muted-foreground">MCP stats unavailable (admin session required).</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Snippet({ title, text, onCopy, copied }: { title: string; text: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase text-muted">{title}</span>
        <button onClick={onCopy} className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-card-hover">{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="max-h-48 overflow-auto p-3 text-[11px] leading-relaxed text-foreground">{text}</pre>
    </div>
  );
}
