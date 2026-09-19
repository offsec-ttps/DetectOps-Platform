"use client";

import { AlertTriangle, Plus, Server } from "lucide-react";
import type { SarProvider, SarTemplateInfo } from "@/types/sar";
import { ProviderIcon } from "./_shared";
import { cn } from "@/lib/utils";

/**
 * Templates grid grouped by provider (AWS / Azure / GCP) with titled sections.
 * Mirrors SAR's own UI layout so users see a familiar structure when they come
 * from localhost:4321.
 */

const PROVIDER_ORDER: SarProvider[] = ["aws", "azure", "gcp"];
const PROVIDER_LABEL: Record<SarProvider, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
};

function CloudTemplateCard({ tpl, onSelect }: { tpl: SarTemplateInfo; onSelect: () => void }) {
  const serverCount = tpl.architecture?.length ?? 0;
  const names = tpl.architecture?.map((s) => s.name).join(" / ") || "—";
  const disabled = tpl.provider_available === false;
  const isCustom = !!(tpl as SarTemplateInfo & { is_custom?: boolean }).is_custom;
  return (
    <div
      onClick={disabled ? undefined : onSelect}
      className={cn(
        "rounded-xl border bg-card p-4 transition-all",
        disabled
          ? "opacity-50 cursor-not-allowed border-border"
          : "cursor-pointer border-border hover:border-accent/40 hover:shadow-sm",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={tpl.provider} />
          <span className="text-[11px] font-medium uppercase text-muted-foreground">{tpl.provider}</span>
        </div>
        <div className="flex items-center gap-1">
          {isCustom && (
            <span className="text-[10px] font-semibold text-accent bg-accent/10 border border-accent/30 rounded-full px-2 py-0.5">
              Custom
            </span>
          )}
          {disabled && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-warning bg-warning/10 border border-warning/30 rounded-full px-2 py-0.5">
              <AlertTriangle className="h-3 w-3" /> CLI missing
            </span>
          )}
        </div>
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{tpl.name.replace(/\.yml$/, "")}</h3>
      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mb-3 min-h-[28px]">
        {tpl.description || "—"}
      </p>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Server className="h-3 w-3" />{serverCount} server{serverCount === 1 ? "" : "s"}</span>
        <span className="truncate">{names}</span>
      </div>
    </div>
  );
}

export default function ProviderGroupedGrid({
  templates, filter, onSelect, onCreateCustom,
}: {
  templates: SarTemplateInfo[];
  filter: "all" | SarProvider;
  onSelect: (tpl: SarTemplateInfo) => void;
  onCreateCustom: (provider: SarProvider) => void;
}) {
  const byProvider = new Map<SarProvider, SarTemplateInfo[]>();
  for (const p of PROVIDER_ORDER) byProvider.set(p, []);
  for (const t of templates) {
    if (filter !== "all" && t.provider !== filter) continue;
    byProvider.get(t.provider)?.push(t);
  }

  const visible = filter === "all" ? PROVIDER_ORDER : [filter];

  return (
    <div className="space-y-6">
      {visible.map((provider) => {
        const group = byProvider.get(provider) || [];
        return (
          <section key={provider}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ProviderIcon provider={provider} className="h-4 w-4" />
                <h3 className="text-sm font-semibold text-foreground">{PROVIDER_LABEL[provider]}</h3>
                <span className="text-[11px] text-muted-foreground">({group.length})</span>
              </div>
              <button
                onClick={() => onCreateCustom(provider)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:bg-accent/10 border border-accent/30 rounded-full px-2.5 py-1 transition-colors"
              >
                <Plus className="h-3 w-3" /> Create custom
              </button>
            </div>
            {group.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
                No {PROVIDER_LABEL[provider]} templates available.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {group.map((tpl) => (
                  <CloudTemplateCard
                    key={`${tpl.provider}/${tpl.name}`}
                    tpl={tpl}
                    onSelect={() => onSelect(tpl)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
