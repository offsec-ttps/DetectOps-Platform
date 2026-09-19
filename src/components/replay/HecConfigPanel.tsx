"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Cloud, Eye, EyeOff,
  Loader2, Plug, RefreshCw, Settings2, Shield, Trash2, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * HEC configuration panel for the Replay Catalog.
 *
 * Two paths to configure:
 *   1. Auto-configure from a running SAR cloud range (one click) —
 *      enables HEC on the range's Splunk, creates a named token, saves it.
 *   2. Manual entry — host / port / token for any Splunk.
 *
 * Also includes a "Send test event" button that POSTs a synthetic event
 * through HEC so the user can verify end-to-end before running a real replay.
 *
 * The token is NEVER sent back to the client in GET responses.
 */

interface HecStatus {
  host: string;
  port: number;
  tokenConfigured: boolean;
  tokenLength: number;
  source: "stored" | "env" | "none";
  label?: string;
  ready: boolean;
}

interface SarRange {
  attack_range_id: string;
  attack_range_name?: string;
  template_name?: string;
  status: string;
}

export default function HecConfigPanel({ onConfigChanged }: { onConfigChanged?: () => void }) {
  const [status, setStatus] = useState<HecStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Manual form state
  const [host, setHost] = useState("");
  const [port, setPort] = useState("8088");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  // Cloud ranges for auto-discover
  const [ranges, setRanges] = useState<SarRange[]>([]);
  const [selectedRange, setSelectedRange] = useState("");
  const [splunkPassword, setSplunkPassword] = useState("changeme123!");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetch("/api/replay/hec-config", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/detection-lab/cloud/attack-range/list", { cache: "no-store" })
          .then((x) => x.ok ? x.json() : { attack_ranges: [] })
          .catch(() => ({ attack_ranges: [] })),
      ]);
      setStatus(s);
      if (s.host) setHost(s.host);
      if (s.port) setPort(String(s.port));
      const running = (r.attack_ranges || []).filter((x: SarRange) => x.status === "running");
      setRanges(running);
      if (!selectedRange && running.length > 0) setSelectedRange(running[0].attack_range_id);
    } catch (e: any) {
      setFlash({ kind: "err", msg: `Failed to load HEC status: ${e?.message || e}` });
    } finally {
      setLoading(false);
    }
  }, [selectedRange]);

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveManual = useCallback(async () => {
    setSaving(true); setFlash(null);
    try {
      const res = await fetch("/api/replay/hec-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port: Number(port) || 8088, token, label: "manual" }),
      });
      const json = await res.json();
      if (!res.ok || json.status !== "ok") throw new Error(json?.message || "save failed");
      setToken(""); // clear in UI once saved
      setFlash({ kind: "ok", msg: `Saved. host=${json.host} port=${json.port}, token length=${json.tokenLength}.` });
      await refresh();
      onConfigChanged?.();
    } catch (e: any) {
      setFlash({ kind: "err", msg: e?.message || "save failed" });
    } finally {
      setSaving(false);
    }
  }, [host, port, token, refresh, onConfigChanged]);

  const clearConfig = useCallback(async () => {
    if (!confirm("Clear the stored HEC config? Replay will fall back to env vars if any are set.")) return;
    setSaving(true); setFlash(null);
    try {
      const res = await fetch("/api/replay/hec-config", { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setToken("");
      setFlash({ kind: "ok", msg: "Stored config cleared." });
      await refresh();
      onConfigChanged?.();
    } catch (e: any) {
      setFlash({ kind: "err", msg: e?.message || "clear failed" });
    } finally {
      setSaving(false);
    }
  }, [refresh, onConfigChanged]);

  const discover = useCallback(async () => {
    if (!selectedRange) { setFlash({ kind: "err", msg: "No running cloud range selected." }); return; }
    setDiscovering(true); setFlash(null);
    try {
      const res = await fetch("/api/replay/hec-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rangeId: selectedRange, splunkPassword }),
      });
      const json = await res.json();
      if (!res.ok || json.status !== "ok") throw new Error(json?.message || "discover failed");
      setFlash({ kind: "ok", msg: json.message || "HEC configured." });
      await refresh();
      onConfigChanged?.();
    } catch (e: any) {
      setFlash({ kind: "err", msg: e?.message || "discover failed" });
    } finally {
      setDiscovering(false);
    }
  }, [selectedRange, splunkPassword, refresh, onConfigChanged]);

  const testConnection = useCallback(async () => {
    setTesting(true); setFlash(null);
    try {
      const res = await fetch("/api/replay/hec-config/test", { method: "POST" });
      const json = await res.json();
      if (res.ok) setFlash({ kind: "ok", msg: json.message });
      else setFlash({ kind: "err", msg: json.message || "test failed" });
    } catch (e: any) {
      setFlash({ kind: "err", msg: e?.message || "test failed" });
    } finally {
      setTesting(false);
    }
  }, []);

  const sourceBadge =
    status?.source === "stored" ? { label: "stored", cls: "bg-accent/10 text-accent border-accent/30" }
    : status?.source === "env" ? { label: "env var", cls: "bg-muted/10 text-muted-foreground border-border" }
    : { label: "not configured", cls: "bg-warning/10 text-warning border-warning/30" };

  return (
    <div className={cn(
      "rounded-xl border p-3 space-y-2",
      status?.ready ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5",
    )}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
          {status?.ready
            ? <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
            : <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />}
          <span className="text-sm font-semibold text-foreground">Splunk HEC configuration</span>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", sourceBadge.cls)}>
            {sourceBadge.label}
          </span>
          {status?.host && (
            <code className="text-xs font-mono text-muted-foreground truncate">
              {status.host}:{status.port}
            </code>
          )}
          {status?.label && <span className="text-xs text-muted-foreground truncate hidden md:inline">· {status.label}</span>}
        </div>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          {status?.ready ? "Ready to replay" : "Click to configure"}
        </span>
      </button>

      {!expanded && !status?.ready && (
        <p className="text-xs text-muted-foreground">
          Replays need a Splunk HEC endpoint to send events to. Click above to expand and use the one-click cloud-range auto-config,
          or paste your host + token manually.
        </p>
      )}

      {expanded && (
        <div className="space-y-4 pt-2">
          {/* ── Auto-configure from running SAR range ── */}
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Auto-configure from a running cloud range</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Enables Splunk HEC on the range's management port, creates a token named{" "}
              <code className="font-mono text-foreground">detection-platform-replay</code>, and saves it here.
              Requires an active WireGuard tunnel.
            </p>
            {ranges.length === 0 ? (
              <p className="text-xs text-warning flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" /> No running cloud ranges. Build one first on the Detection Eng Lab → Cloud tab.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-2 items-end">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Running range</span>
                  <select
                    value={selectedRange} onChange={(e) => setSelectedRange(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                  >
                    {ranges.map((r) => (
                      <option key={r.attack_range_id} value={r.attack_range_id}>
                        {r.attack_range_id.slice(0, 8)} · {r.template_name?.replace(/\.yml$/, "") || "range"} · {r.attack_range_name || "ar"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Splunk admin password</span>
                  <input
                    type="password" value={splunkPassword} onChange={(e) => setSplunkPassword(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground"
                  />
                </label>
                <button
                  onClick={discover} disabled={discovering || !selectedRange}
                  className="rounded-lg bg-accent/10 border border-accent/30 text-accent px-3 py-1.5 text-sm font-semibold hover:bg-accent/20 disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  {discovering ? "Configuring…" : "Auto-configure"}
                </button>
              </div>
            )}
          </div>

          {/* ── Manual entry ── */}
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-foreground">Manual entry</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Use any Splunk Cloud / Enterprise instance. Copy the token from Splunk's{" "}
              <em>Settings → Data Inputs → HTTP Event Collector</em>.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <label className="block col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Host</span>
                <input
                  value={host} onChange={(e) => setHost(e.target.value)}
                  placeholder="e.g. 10.0.2.10 or splunk.example.com"
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Port</span>
                <input
                  type="number" value={port} onChange={(e) => setPort(e.target.value)} min={1} max={65535}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">HEC token</span>
              <div className="mt-1 flex gap-1">
                <input
                  type={showToken ? "text" : "password"}
                  value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground"
                />
                <button onClick={() => setShowToken((v) => !v)} className="px-2 text-muted-foreground hover:text-foreground border border-border rounded-lg">
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {status?.tokenConfigured && !token && (
                <span className="text-xs text-muted-foreground">A token of length {status.tokenLength} is already saved. Leave empty to keep it.</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={saveManual} disabled={saving || !host || !token}
                className="rounded-lg bg-accent/10 border border-accent/30 text-accent px-3 py-1.5 text-sm font-medium hover:bg-accent/20 disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                Save
              </button>
              {status?.source === "stored" && (
                <button
                  onClick={clearConfig} disabled={saving}
                  className="rounded-lg border border-border text-muted-foreground px-3 py-1.5 text-sm hover:bg-card-hover disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
          </div>

          {/* ── Test connection ── */}
          <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-foreground">Test connection</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Sends one synthetic event. Verify in Splunk with: <code className="font-mono">search sourcetype="detection-platform:hec-test"</code>
              </p>
            </div>
            <button
              onClick={testConnection} disabled={testing || !status?.ready}
              className="rounded-lg border border-border text-foreground px-3 py-1.5 text-sm font-medium hover:bg-card-hover disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
              Send test event
            </button>
          </div>

          <div className="flex justify-end">
            <button onClick={refresh} disabled={loading} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> refresh
            </button>
          </div>
        </div>
      )}

      {flash && (
        <div className={cn(
          "text-xs rounded px-2 py-1.5",
          flash.kind === "ok" ? "bg-success/10 text-success border border-success/30"
                              : "bg-danger/10 text-danger border border-danger/30",
        )}>
          {flash.msg}
        </div>
      )}
    </div>
  );
}
