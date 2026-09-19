"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Shield, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Per-range IP-sync card. Detects when the user's public IP doesn't match
 * what the range's security group allows — the #1 reason tunnels "mysteriously"
 * stop working after an hour or two on residential ISPs.
 *
 * One button: "Sync my IP" → adds current IP to the SG for 51820/udp + 22/tcp.
 * Optional checkbox: also revoke stale IPs (keeps the SG tidy over time).
 */

interface Status {
  rangeId: string;
  routerInstanceId: string | null;
  region: string | null;
  sgId: string | null;
  currentIp: string | null;
  allowedUdpCidrs: string[];
  allowedTcpCidrs: string[];
  inSync: boolean;
  staleCidrs: string[];
  error?: string;
}

export default function IpSyncCard({ rangeId }: { rangeId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [revokeStale, setRevokeStale] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/detection-lab/cloud/sg-status/${rangeId}`, { cache: "no-store" });
      const json = await res.json();
      setStatus(json);
    } catch (e: any) {
      setStatus({
        rangeId, routerInstanceId: null, region: null, sgId: null,
        currentIp: null, allowedUdpCidrs: [], allowedTcpCidrs: [],
        inSync: false, staleCidrs: [],
        error: e?.message || "status probe failed",
      });
    } finally {
      setLoading(false);
    }
  }, [rangeId]);

  useEffect(() => { refresh(); }, [refresh]);

  const doSync = useCallback(async () => {
    setSyncing(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/detection-lab/cloud/sg-sync/${rangeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoke_stale: revokeStale }),
      });
      const json = await res.json();
      if (!res.ok || json.status !== "ok") throw new Error(json?.message || "sync failed");
      setStatus(json.after);
      setFlash({
        kind: "ok",
        msg: `Added ${json.addedCidr} to ${json.sgId}. ` +
             (json.revoked?.length ? `Revoked ${json.revoked.length} stale rule(s). ` : "") +
             `Tunnel should re-handshake within ~30s.`,
      });
    } catch (e: any) {
      setFlash({ kind: "err", msg: e?.message || "sync failed" });
    } finally {
      setSyncing(false);
    }
  }, [rangeId, revokeStale]);

  // Compact banner while loading / on error / no SG found
  if (loading && !status) {
    return (
      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking IP whitelist…
      </div>
    );
  }
  if (!status || status.error || !status.sgId) {
    return (
      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          IP sync unavailable: {status?.error || "no router SG"}
        </span>
        <button onClick={refresh} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <RefreshCw className="h-3 w-3" /> retry
        </button>
      </div>
    );
  }

  const outOfSync = !status.inSync;

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2",
      outOfSync ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5",
    )}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {outOfSync
            ? <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
            : <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />}
          <span className="text-sm font-semibold text-foreground">
            {outOfSync ? "Your public IP is NOT in the AWS whitelist" : "IP whitelist in sync"}
          </span>
        </div>
        <button
          onClick={refresh} disabled={loading}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-40"
          title="Refresh status"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <span className="text-muted-foreground">Your current IP: </span>
          <code className="font-mono text-foreground">{status.currentIp || "unknown"}</code>
        </div>
        <div>
          <span className="text-muted-foreground">Security group: </span>
          <code className="font-mono text-muted-foreground">{status.sgId}</code>
        </div>
        <div className="col-span-2">
          <span className="text-muted-foreground">Allowed (51820/udp): </span>
          <span className="font-mono">
            {status.allowedUdpCidrs.length
              ? status.allowedUdpCidrs.map((c) => (
                  <span key={c} className={cn(
                    "inline-block mr-1 px-1.5 py-0 rounded border text-[11px]",
                    c === `${status.currentIp}/32`
                      ? "text-success bg-success/10 border-success/30"
                      : "text-muted-foreground bg-muted/10 border-border",
                  )}>{c}</span>
                ))
              : <span className="text-muted-foreground">(none)</span>}
          </span>
        </div>
      </div>

      {outOfSync && (
        <p className="text-xs text-muted-foreground">
          Your ISP likely rotated your public IP. The WireGuard tunnel will look connected but traffic
          will silently drop at the AWS edge. Click <strong>Sync my IP</strong> to add the current IP
          to the security group — takes under 5 seconds, no redeploy.
        </p>
      )}

      {flash && (
        <div className={cn(
          "text-xs rounded px-2 py-1",
          flash.kind === "ok" ? "bg-success/10 text-success border border-success/30"
                              : "bg-danger/10 text-danger border border-danger/30",
        )}>
          {flash.msg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={doSync} disabled={syncing || !status.currentIp}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
            outOfSync
              ? "bg-warning/10 border border-warning/30 text-warning hover:bg-warning/20"
              : "bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20",
          )}
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
          {syncing ? "Syncing…" : outOfSync ? "Sync my IP" : "Re-sync (already current)"}
        </button>

        {status.staleCidrs.length > 0 && (
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox" checked={revokeStale} onChange={(e) => setRevokeStale(e.target.checked)}
              className="accent-danger"
            />
            <Trash2 className="h-3 w-3" />
            Also revoke {status.staleCidrs.length} stale CIDR{status.staleCidrs.length === 1 ? "" : "s"}
          </label>
        )}
      </div>
    </div>
  );
}
