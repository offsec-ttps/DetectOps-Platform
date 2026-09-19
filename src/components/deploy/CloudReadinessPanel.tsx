"use client";

/**
 * Pre-deploy readiness for the Cloud Lab path.
 *
 * Before the user clicks Deploy, show — per provider (AWS/Azure/GCP) — whether
 * they've added their own API credentials, plus whether the SAR controller and
 * each provider's CLI are reachable. Answers "are my prerequisites met?" up front.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, KeyRound, Cloud, Plus } from "lucide-react";
import { sarHealth, sarProvidersCheck } from "@/lib/sar-client";
import { cn } from "@/lib/utils";

const PROVIDERS: { id: "aws" | "azure" | "gcp"; label: string; keyName: string }[] = [
  { id: "aws", label: "AWS", keyName: "Access Key ID + Secret" },
  { id: "azure", label: "Azure", keyName: "Service Principal" },
  { id: "gcp", label: "GCP", keyName: "Service Account JSON" },
];

export default function CloudReadinessPanel() {
  const [loading, setLoading] = useState(true);
  const [keysByProvider, setKeysByProvider] = useState<Record<string, number>>({});
  const [sarUp, setSarUp] = useState<boolean | null>(null);
  const [available, setAvailable] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    // Credentials (the headline signal — does the user have their own keys?)
    try {
      const r = await fetch("/api/cloud-credentials");
      const d = await r.json();
      const counts: Record<string, number> = {};
      for (const it of d.items || []) counts[String(it.provider).toLowerCase()] = (counts[String(it.provider).toLowerCase()] || 0) + 1;
      setKeysByProvider(counts);
    } catch { setKeysByProvider({}); }
    // SAR controller + provider CLI availability (best-effort)
    try {
      const h = await sarHealth();
      setSarUp(!!h);
      try {
        const p = await sarProvidersCheck();
        const av: Record<string, boolean> = {};
        for (const pr of p.providers || []) av[String(pr.provider).toLowerCase()] = !!pr.available;
        setAvailable(av);
      } catch { setAvailable({}); }
    } catch { setSarUp(false); setAvailable({}); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const anyKey = Object.values(keysByProvider).some((n) => n > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><KeyRound className="h-4 w-4 text-accent" /> Pre-deploy readiness</h3>
          <p className="text-xs text-muted-foreground mt-1">Cloud labs deploy into <span className="text-foreground">your own</span> account. Confirm your provider keys are added before deploying below.</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover disabled:opacity-50">
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* SAR controller status */}
      <div className={cn("rounded-lg border px-3 py-2 text-[11px] inline-flex items-center gap-2",
        sarUp === null ? "border-border text-muted-foreground" : sarUp ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger")}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sarUp ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
        SAR controller {sarUp === null ? "—" : sarUp ? "reachable" : "not reachable (cloud deploy is unavailable until it's up)"}
      </div>

      {/* Per-provider readiness */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PROVIDERS.map((p) => {
          const n = keysByProvider[p.id] || 0;
          const hasKey = n > 0;
          const cliKnown = p.id in available;
          const cliOk = available[p.id];
          const ready = hasKey && (!sarUp || !cliKnown || cliOk);
          return (
            <div key={p.id} className={cn("rounded-xl border p-4", hasKey ? "border-success/30 bg-success/[0.03]" : "border-border")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Cloud className="h-4 w-4 text-accent" /><span className="text-sm font-semibold text-foreground">{p.label}</span></div>
                {ready ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
              </div>
              {/* credentials */}
              <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                {hasKey
                  ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> API key added{n > 1 ? ` (${n})` : ""}</span>
                  : <span className="inline-flex items-center gap-1 text-danger"><XCircle className="h-3 w-3" /> No API key</span>}
              </div>
              {/* provider CLI (only meaningful when SAR is up) */}
              {sarUp && cliKnown && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                  {cliOk
                    ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" /> Provider CLI authenticated</span>
                    : <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="h-3 w-3" /> CLI not authenticated in controller</span>}
                </div>
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">{p.keyName}</p>
              {!hasKey && (
                <Link href="/settings/cloud-credentials" className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-2.5 py-1 hover:bg-[#60a5fa]">
                  <Plus className="h-3 w-3" /> Add {p.label} key
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {!anyKey && !loading && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> No cloud credentials yet — add a provider key under <Link href="/settings/cloud-credentials" className="underline mx-1">Cloud Credentials</Link> before deploying.
        </div>
      )}
    </div>
  );
}
