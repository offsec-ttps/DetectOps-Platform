"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, Loader2, RefreshCw, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SarOperationStatus } from "@/types/sar";

interface SgStatus {
  rangeId: string;
  currentIp: string | null;
  sgId: string | null;
  inSync: boolean;
  error?: string;
}

/**
 * Top-level connectivity health strip for the Cloud tab.
 *
 * Calls /sg-status for each running range. If any is out of sync (your public IP
 * not in the range's AWS whitelist), shows a prominent banner with a one-click
 * "Sync all" button and a collapsible troubleshooting panel. This is the
 * "why can't I connect?!" mini-dashboard.
 */
export default function ConnectivityHealthStrip({
  ranges, onOpenRange,
}: {
  ranges: SarOperationStatus[];
  /** Called when user clicks a range's "Open" link. Lets CloudTab switch view. */
  onOpenRange: (rangeId: string) => void;
}) {
  const runningRanges = ranges.filter((r) => r.status === "running" && r.attack_range_id);
  const [statuses, setStatuses] = useState<Record<string, SgStatus>>({});
  const [loading, setLoading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const refresh = useCallback(async () => {
    if (runningRanges.length === 0) { setStatuses({}); return; }
    setLoading(true);
    const results = await Promise.all(runningRanges.map(async (r) => {
      try {
        const res = await fetch(`/api/detection-lab/cloud/sg-status/${r.attack_range_id}`, { cache: "no-store" });
        return await res.json() as SgStatus;
      } catch (e: any) {
        return { rangeId: r.attack_range_id!, currentIp: null, sgId: null, inSync: false, error: e?.message } as SgStatus;
      }
    }));
    setStatuses(Object.fromEntries(results.map((s) => [s.rangeId, s])));
    setLoading(false);
  }, [runningRanges.map((r) => r.attack_range_id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh(); }, [refresh]);

  const outOfSync = Object.values(statuses).filter((s) => !s.inSync && !s.error && s.sgId);
  const errored = Object.values(statuses).filter((s) => s.error || !s.sgId);

  const syncAll = useCallback(async () => {
    setSyncingAll(true); setFlash(null);
    const results = await Promise.all(outOfSync.map(async (s) => {
      try {
        const res = await fetch(`/api/detection-lab/cloud/sg-sync/${s.rangeId}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revoke_stale: false }),
        });
        return (await res.json()).status === "ok";
      } catch { return false; }
    }));
    const ok = results.filter(Boolean).length;
    setFlash(`Synced ${ok} of ${outOfSync.length} range(s).`);
    await refresh();
    setSyncingAll(false);
  }, [outOfSync, refresh]);

  // Don't render when no running ranges (nothing to watch)
  if (runningRanges.length === 0) return null;

  const allGood = outOfSync.length === 0 && errored.length === 0 && Object.keys(statuses).length === runningRanges.length;

  return (
    <div className={cn(
      "rounded-xl border p-3 space-y-2",
      outOfSync.length > 0 ? "border-warning/40 bg-warning/5"
      : errored.length > 0 ? "border-border bg-muted/5"
      : allGood ? "border-success/30 bg-success/5"
      : "border-border bg-card",
    )}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {loading && !Object.keys(statuses).length ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            : outOfSync.length > 0 ? <AlertTriangle className="h-4 w-4 text-warning" />
            : allGood ? <CheckCircle2 className="h-4 w-4 text-success" />
            : <Shield className="h-4 w-4 text-muted-foreground" />}
          <span className="text-sm font-semibold text-foreground">
            {loading && !Object.keys(statuses).length ? "Checking connectivity…"
              : outOfSync.length > 0 ? `${outOfSync.length} range${outOfSync.length === 1 ? "" : "s"} out of IP sync`
              : allGood ? `Connectivity OK — all ${runningRanges.length} running range${runningRanges.length === 1 ? "" : "s"} whitelist your current IP`
              : errored.length > 0 ? "Couldn't check IP sync for some ranges"
              : "Running ranges"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <HelpCircle className="h-3 w-3" />
            Troubleshoot
            {showHelp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          <button
            onClick={refresh} disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> refresh
          </button>
          {outOfSync.length > 0 && (
            <button
              onClick={syncAll} disabled={syncingAll}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-warning/10 border border-warning/30 text-warning px-3 py-1 text-xs font-semibold hover:bg-warning/20 disabled:opacity-40"
            >
              {syncingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
              {syncingAll ? "Syncing…" : `Sync my IP on ${outOfSync.length} range${outOfSync.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>

      {outOfSync.length > 0 && (
        <ul className="text-xs space-y-0.5">
          {outOfSync.map((s) => {
            const r = runningRanges.find((x) => x.attack_range_id === s.rangeId);
            return (
              <li key={s.rangeId} className="flex items-center gap-2 text-muted-foreground">
                <code className="font-mono">{s.rangeId.slice(0, 8)}</code>
                <span>·</span>
                <span>{r?.template_name?.replace(/\.yml$/, "") || "range"}</span>
                <span>·</span>
                <span>current IP <code className="font-mono text-foreground">{s.currentIp || "?"}</code> not whitelisted</span>
                <button onClick={() => onOpenRange(s.rangeId)} className="ml-auto text-accent hover:underline">Open</button>
              </li>
            );
          })}
        </ul>
      )}

      {flash && <p className="text-xs text-success bg-success/10 border border-success/30 rounded px-2 py-1">{flash}</p>}

      {showHelp && (
        <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">Can't reach your lab hosts?</p>
          <ol className="list-decimal ml-4 space-y-1.5">
            <li>
              <strong className="text-foreground">Check IP whitelist (most common):</strong>{" "}
              Residential ISPs rotate public IPs. If your tunnel looks connected but <code className="font-mono">ping 10.0.2.10</code> times out,
              click <strong>Sync my IP</strong> above — it adds your current IP to the range's AWS security group in one call.
              Takes ~5 seconds, no redeploy.
            </li>
            <li>
              <strong className="text-foreground">WireGuard config is stale:</strong>{" "}
              If SAR regenerated the router's keys (e.g. after a restart), re-download the latest config from
              the range's detail view <strong>Access → WireGuard tunnel → Copy/Download .conf</strong>. Then on the host: <code className="font-mono">sudo wg-quick down wg0 &amp;&amp; sudo wg-quick up /path/to/new.conf</code>.
            </li>
            <li>
              <strong className="text-foreground">Range itself is unhealthy:</strong>{" "}
              If the above don't help, check the range status in the detail view. A failed or stopped range
              needs to be destroyed and rebuilt. Use the <strong>Destroy</strong> button then re-build from the template grid.
            </li>
            <li>
              <strong className="text-foreground">Windows hosts don't respond to ping:</strong>{" "}
              Default Windows firewall drops ICMP. Test with <code className="font-mono">nc -zv 10.0.2.11 3389</code> or just RDP via Guacamole.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
