"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, AlertTriangle, CheckCircle2, ExternalLink, ChevronDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Props {
  sourceType: "ti" | "rule";
  /** Pre-filled when mounting on a TI report page */
  threatIntelReportId?: string;
  /** Pre-filled when mounting on a community-rule detail page */
  sourceTable?: "CommunityRule" | "CommunitySigmaRule" | "CommunityElasticRule" | "SplunkDetection";
  ruleId?: string;
  /** Renders compact (icon-only on small viewports) vs full-button */
  size?: "sm" | "md";
}

interface ProviderRow { id: string; label: string; configured: boolean }

export default function GenerateButton(p: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ packId: string; totalCostUsd: number; provider?: string } | null>(null);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string>("anthropic");
  const [chosen, setChosen] = useState<string>("");
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);

  // Probe configured providers once, lazily. The API's `defaultProvider` is
  // now the SMART default — i.e., a provider that actually has a key (env or
  // DB). When the user later picks one explicitly, `chosen` wins.
  useEffect(() => {
    fetch("/api/llm-providers")
      .then((r) => r.json())
      .then((d) => {
        const ps = d.providers || [];
        setProviders(ps);
        const smart = d.defaultProvider || "anthropic";
        // Belt-and-braces: if the server's smartDefault somehow came back
        // unconfigured (race during HMR, fresh boot, etc.), pick the first
        // configured one client-side so the button is never primed to a
        // provider with no key.
        const smartIsConfigured = ps.find((p: ProviderRow) => p.id === smart)?.configured;
        const fallback = ps.find((p: ProviderRow) => p.configured)?.id;
        setDefaultProvider(smartIsConfigured ? smart : (fallback || smart));
      })
      .catch(() => { /* button still works with implicit default */ });
  }, []);

  const activeProvider = chosen || defaultProvider;
  const activeProviderConfigured = providers.find((x) => x.id === activeProvider)?.configured ?? true;
  const activeProviderLabel = providers.find((x) => x.id === activeProvider)?.label || activeProvider;

  const generate = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const url = p.sourceType === "ti" ? "/api/detection-packs/generate-from-ti" : "/api/detection-packs/generate-from-rule";
      const body: Record<string, unknown> = p.sourceType === "ti"
        ? { threatIntelReportId: p.threatIntelReportId }
        : { sourceTable: p.sourceTable, ruleId: p.ruleId };
      // ALWAYS send the active provider — both the explicitly-chosen one
      // and the smart default. Previously we only sent `provider` when the
      // user opened the dropdown, which meant clicking the main button fell
      // back to the server's hardcoded default (anthropic) even when the
      // user had only configured a different provider.
      if (activeProvider) body.provider = activeProvider;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.code === "missing_api_key"
          ? `Provider "${activeProvider}" has no API key. Add one at /settings/llm-providers (or set the corresponding env var) and try again.`
          : data.error || "Generation failed");
        return;
      }
      setResult({ packId: data.packId, totalCostUsd: data.totalCostUsd, provider: activeProvider });
    } catch (err: any) {
      setError(err?.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="inline-flex flex-col gap-1">
        <Link
          href={`/detections/packs/${result.packId}`}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-success/15 text-success border border-success/40 hover:bg-success/25"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Detection Pack ready
          <ExternalLink className="h-3 w-3" />
        </Link>
        <span className="text-[10px] text-muted-foreground">
          {result.provider && <>{result.provider} · </>}cost ${result.totalCostUsd.toFixed(4)}
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="inline-flex rounded-md overflow-hidden border border-info/30">
        <button
          onClick={generate}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 font-medium transition-colors disabled:opacity-50",
            p.size === "sm" ? "h-7 text-[11px]" : "h-9 text-xs",
            "bg-gradient-to-r from-info to-purple text-white hover:opacity-90",
          )}
          title={`Generate via ${activeProviderLabel}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Generate Detection Pack
        </button>
        {providers.length > 1 && (
          <div className="relative">
            <button
              onClick={() => setProviderMenuOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-0.5 px-1.5 font-medium",
                p.size === "sm" ? "h-7 text-[10px]" : "h-9 text-[11px]",
                "bg-info text-white hover:bg-info/80",
              )}
              title={`Provider: ${activeProviderLabel}`}
            >
              <span className="hidden sm:inline">{activeProviderLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {providerMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 rounded-md border border-border bg-card shadow-xl min-w-[180px]">
                {providers.map((pp) => (
                  <button
                    key={pp.id}
                    onClick={() => { setChosen(pp.id); setProviderMenuOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-card-hover",
                      pp.id === activeProvider && "bg-card-hover",
                    )}
                    disabled={!pp.configured}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", pp.configured ? "bg-success" : "bg-muted")} />
                    <span className="flex-1 text-foreground">{pp.label}</span>
                    {!pp.configured && <span className="text-[9px] text-muted-foreground">no key</span>}
                  </button>
                ))}
                <Link
                  href="/settings/llm-providers"
                  onClick={() => setProviderMenuOpen(false)}
                  className="block px-3 py-1.5 text-[11px] text-accent hover:bg-card-hover border-t border-border"
                >
                  Manage providers →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="inline-flex items-start gap-1 text-[10px] text-danger max-w-[320px]">
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
