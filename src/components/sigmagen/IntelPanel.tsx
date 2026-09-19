"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, ShieldAlert, Bug, Clock, Network, FileWarning, Wrench, Crosshair, ExternalLink } from "lucide-react";

interface Cve { id: string; description?: string; cvssScore?: number; affected?: string }
interface TimelineItem { order: number; timeframe?: string; event: string; techniqueId?: string }
interface Mitigation { title: string; description?: string; mitreMitigationId?: string }
interface MappedTech { techniqueId: string; techniqueName?: string; tactic?: string; confidence?: number; dataSources?: string[]; detectionOpportunity?: string }

export interface IntelData {
  summary?: string;
  attackProfile?: { overview?: string; objective?: string; sophistication?: string; killChainSummary?: string; affectedProducts?: string[] };
  threatActor?: { name?: string; aliases?: string[]; attribution?: string; confidence?: number; motivation?: string; nationState?: string };
  malwareFamilies?: string[];
  targetedSectors?: string[];
  targetedRegions?: string[];
  cves?: Cve[];
  timeline?: TimelineItem[];
  iocs?: Record<string, string[]>;
  mitigations?: Mitigation[];
  mappedTechniques?: MappedTech[];
  tactics?: string[];
  coverageNotes?: string;
}

function Section({ icon: Icon, title, count, defaultOpen, children }: { icon: React.ElementType; title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b border-border last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 py-2 text-left">
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-90")} />
        <Icon className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {count !== undefined && <span className="rounded-full bg-card-hover px-1.5 py-0.5 text-[10px] text-muted">{count}</span>}
      </button>
      {open && <div className="pb-3 pl-6 pr-1">{children}</div>}
    </div>
  );
}

const IOC_LABEL: Record<string, string> = { ipv4: "IPv4", ipv6: "IPv6", domains: "Domains", urls: "URLs", hashes: "Hashes", emails: "Emails", registry: "Registry", filePaths: "File paths", other: "Other" };

export function IntelPanel({ intel }: { intel: IntelData }) {
  if (!intel || !intel.summary) return null;
  const ap = intel.attackProfile || {};
  const ta = intel.threatActor || {};
  const iocEntries = Object.entries(intel.iocs || {}).filter(([, v]) => Array.isArray(v) && v.length);
  const iocTotal = iocEntries.reduce((n, [, v]) => n + (v as string[]).length, 0);

  return (
    <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
      {/* Header: actor + summary */}
      {ta.name && (
        <div className="mb-1 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-danger" />
          <span className="text-sm font-semibold text-foreground">{ta.name}</span>
          {ta.aliases?.length ? <span className="text-[10px] text-muted">aka {ta.aliases.join(", ")}</span> : null}
          {typeof ta.confidence === "number" && <span className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] text-muted">{Math.round(ta.confidence * 100)}% conf</span>}
        </div>
      )}
      <p className="text-sm leading-relaxed text-foreground">{intel.summary}</p>

      <div className="mt-2 -mb-1 divide-y divide-border">
        {/* Attack profile */}
        {(ap.overview || ap.objective || ap.killChainSummary) && (
          <Section icon={Crosshair} title="Attack profile" defaultOpen>
            {ap.objective && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Objective:</span> {ap.objective}</p>}
            {ap.sophistication && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Sophistication:</span> {ap.sophistication}</p>}
            {ap.overview && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{ap.overview}</p>}
            {ap.killChainSummary && <p className="mt-1 text-[11px] leading-snug text-muted-foreground"><span className="font-medium text-foreground">Kill chain:</span> {ap.killChainSummary}</p>}
            {ap.affectedProducts?.length ? <p className="mt-1 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Affected:</span> {ap.affectedProducts.join(", ")}</p> : null}
            {(ta.motivation || ta.nationState || ta.attribution) && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {ta.nationState && <><span className="font-medium text-foreground">Nation-state:</span> {ta.nationState}. </>}
                {ta.motivation && <><span className="font-medium text-foreground">Motivation:</span> {ta.motivation}. </>}
                {ta.attribution && <><span className="font-medium text-foreground">Attribution:</span> {ta.attribution}.</>}
              </p>
            )}
          </Section>
        )}

        {/* CVEs */}
        {intel.cves?.length ? (
          <Section icon={Bug} title="CVEs" count={intel.cves.length} defaultOpen>
            <ul className="space-y-1">
              {intel.cves.map((c) => (
                <li key={c.id} className="text-[11px] text-muted-foreground">
                  <a href={`https://nvd.nist.gov/vuln/detail/${c.id}`} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">{c.id}</a>
                  {typeof c.cvssScore === "number" && <span className="ml-1.5 rounded bg-severity-high/15 px-1 text-[10px] text-severity-high">CVSS {c.cvssScore}</span>}
                  {c.affected && <span className="ml-1">· {c.affected}</span>}
                  {c.description && <span className="block ml-0 text-muted">{c.description}</span>}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* Timeline */}
        {intel.timeline?.length ? (
          <Section icon={Clock} title="Attack timeline" count={intel.timeline.length}>
            <ol className="space-y-1.5">
              {intel.timeline.map((t, i) => (
                <li key={i} className="relative pl-4 text-[11px] text-muted-foreground before:absolute before:left-0 before:top-1.5 before:h-1.5 before:w-1.5 before:rounded-full before:bg-accent">
                  {t.timeframe && <span className="font-medium text-foreground">{t.timeframe}: </span>}{t.event}
                  {t.techniqueId && <span className="ml-1 font-mono text-[10px] text-accent">{t.techniqueId}</span>}
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {/* IOCs */}
        {iocEntries.length ? (
          <Section icon={Network} title="Indicators of Compromise" count={iocTotal}>
            <div className="space-y-1.5">
              {iocEntries.map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{IOC_LABEL[k] || k} ({(v as string[]).length})</div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(v as string[]).slice(0, 30).map((ioc, i) => <span key={i} className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground break-all">{ioc}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* Mitigations */}
        {intel.mitigations?.length ? (
          <Section icon={Wrench} title="Mitigations" count={intel.mitigations.length}>
            <ul className="space-y-1">
              {intel.mitigations.map((m, i) => (
                <li key={i} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{m.title}</span>{m.mitreMitigationId && <span className="ml-1 font-mono text-[10px] text-accent">{m.mitreMitigationId}</span>}
                  {m.description && <span className="block text-muted">{m.description}</span>}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {/* ATT&CK techniques with detection opportunities */}
        {intel.mappedTechniques?.length ? (
          <Section icon={Crosshair} title="ATT&CK techniques & detection opportunities" count={intel.mappedTechniques.length}>
            <ul className="space-y-1.5">
              {intel.mappedTechniques.map((t) => (
                <li key={t.techniqueId} className="text-[11px]">
                  <span className="font-mono text-accent">{t.techniqueId}</span>
                  {t.techniqueName && <span className="text-foreground"> {t.techniqueName}</span>}
                  {t.tactic && <span className="ml-1 rounded bg-card-hover px-1 text-[10px] text-muted">{t.tactic}</span>}
                  {typeof t.confidence === "number" && <span className="ml-1 text-[10px] text-muted">{Math.round(t.confidence * 100)}%</span>}
                  {t.detectionOpportunity && <span className="block text-muted-foreground">→ {t.detectionOpportunity}</span>}
                  {t.dataSources?.length ? <span className="block text-muted">data: {t.dataSources.join(", ")}</span> : null}
                </li>
              ))}
            </ul>
            {intel.coverageNotes && <p className="mt-2 text-[10px] italic text-muted">{intel.coverageNotes}</p>}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
