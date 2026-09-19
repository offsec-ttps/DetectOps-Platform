"use client";

/**
 * Cloud lab templates — shown on the Cloud Lab deploy page directly below
 * "Pre-deploy readiness". Lists the templates the extracted SAR Cloud Controller
 * offers (AWS/Azure/GCP), fetched live from its Flask API through our same-origin
 * proxy `/api/cloud-lab/templates`. The controller (Astro UI :4321 + Flask API
 * :4000) is launched alongside the app by start-server.sh; if it isn't up yet the
 * panel degrades to a short hint instead of erroring.
 */

import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw, Loader2, ExternalLink, Server, Layers, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArchNode { name: string; os_type?: string; instance_type?: string; roles?: string[] }
interface CloudTemplate { name: string; description?: string; provider: string; provider_available?: boolean; architecture?: ArchNode[] }
interface TemplatesResp {
  available: boolean; error?: string; apiUrl?: string; appUrl?: string;
  templates: CloudTemplate[]; provider_availability: Record<string, { available?: boolean }>;
}

const PROVIDER_LABEL: Record<string, string> = { aws: "AWS", azure: "Azure", gcp: "GCP" };
const PROVIDER_ORDER = ["aws", "azure", "gcp"];
const prettyName = (n: string) => n.replace(/\.ya?ml$/i, "").replace(/_/g, " ");

export default function CloudTemplatesPanel() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TemplatesResp | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/cloud-lab/templates", { cache: "no-store" });
      setData(await r.json());
    } catch (e: any) {
      setData({ available: false, error: e?.message || "failed to load", templates: [], provider_availability: {} });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const templates = data?.templates || [];
  const appUrl = data?.appUrl || "http://localhost:4321";
  const byProvider = PROVIDER_ORDER
    .map((p) => ({ provider: p, items: templates.filter((t) => (t.provider || "").toLowerCase() === p) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Cloud className="h-4 w-4 text-accent" /> Cloud lab templates</h3>
          <p className="text-xs text-muted-foreground mt-1">Templates the cloud controller can deploy into your own account. Open one in the controller to configure and launch it.</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.available && (
            <a href={appUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-accent/40 px-2.5 py-1 text-[11px] text-accent hover:bg-accent/10">
              <ExternalLink className="h-3 w-3" /> Cloud Controller
            </a>
          )}
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover disabled:opacity-50">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </div>

      {/* Provider availability strip */}
      {data?.available && (
        <div className="flex flex-wrap items-center gap-2">
          {PROVIDER_ORDER.map((p) => {
            const ok = data.provider_availability?.[p]?.available;
            return (
              <span key={p} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium",
                ok ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-success" : "bg-muted-foreground/40")} />
                {PROVIDER_LABEL[p]} CLI {ok ? "ready" : "not configured"}
              </span>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !data?.available ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[11px] text-warning flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="text-foreground font-medium">Cloud controller isn&apos;t running.</p>
            <p className="mt-0.5">{data?.error || "Couldn't reach the cloud controller API on :4000."} It launches with your dev environment (start-server.sh) — start it, then Refresh to see the {"≈"}20 AWS/Azure/GCP templates.</p>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">The cloud controller is up but returned no templates.</p>
      ) : (
        <div className="space-y-4">
          {byProvider.map((group) => (
            <div key={group.provider} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{PROVIDER_LABEL[group.provider] || group.provider} · {group.items.length}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.items.map((t) => {
                  const arch = t.architecture || [];
                  const osTypes = [...new Set(arch.map((a) => a.os_type).filter(Boolean))] as string[];
                  return (
                    <div key={t.name} className="rounded-xl border border-border bg-card p-4 flex flex-col">
                      <div className="flex items-start gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent shrink-0"><Layers className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground capitalize truncate">{prettyName(t.name)}</p>
                          <p className="text-[10px] uppercase font-bold text-muted-foreground">{PROVIDER_LABEL[t.provider] || t.provider}</p>
                        </div>
                      </div>
                      {t.description && <p className="mt-2 text-[11px] text-muted-foreground line-clamp-3">{t.description}</p>}
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Server className="h-3 w-3" /> {arch.length} host{arch.length === 1 ? "" : "s"}
                        {osTypes.length > 0 && <span>· {osTypes.join(", ")}</span>}
                      </div>
                      {arch.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {arch.slice(0, 4).map((a, i) => (
                            <span key={i} className="rounded border border-border px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">{a.name}</span>
                          ))}
                        </div>
                      )}
                      <a href={appUrl} target="_blank" rel="noreferrer"
                        className="mt-3 inline-flex items-center justify-center gap-1.5 text-[11px] h-7 rounded-md border border-border text-foreground hover:bg-card-hover">
                        <ExternalLink className="h-3 w-3" /> Open in Cloud Controller
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
