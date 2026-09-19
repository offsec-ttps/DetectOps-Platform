"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, Swords, FileCode, ChevronRight, ExternalLink, Repeat, Terminal, Link2 } from "lucide-react";

interface PackRule { id: string; format: string; title: string; body: string; language: string; validationStatus: string; validationNotes: string; falsePositives: string[] }
interface PackDetail { id: string; name: string; rules: PackRule[]; simulations: any[] }

export interface SimEntry { source: string; techniqueId: string; name: string; description?: string; executor?: string; command?: string; cleanupCommand?: string; prerequisites?: string; expectedTelemetry?: string; rationale?: string }
export interface RichUseCase {
  id?: string; name: string; detectionObjective?: string; scenarioDescription?: string;
  mitreTechniques?: string[]; mitreTactics?: string[]; platforms?: string[];
  logSources?: string[]; detectionLogic?: string; validationProcedure?: string; expectedAlerts?: string[];
  steps?: Array<{ order: number; techniqueId: string; name: string; action: string; expectedSignal?: string }>;
  simulations?: SimEntry[];
}
export interface RunRef { title: string; url: string; type: string }

type Tab = "usecases" | "rules" | "simulations" | "references";

const VAL_STATUS: Record<string, { label: string; status: any }> = {
  converted: { label: "validated", status: "success" }, valid: { label: "valid", status: "success" },
  invalid: { label: "invalid", status: "error" }, unvalidated: { label: "unverified", status: "draft" },
};
const FW_LABEL: Record<string, string> = { atomic: "Atomic Red Team", purplesharp: "PurpleSharp", stratus: "Stratus Red Team", custom: "Generated procedure" };
const CONVERT_TARGETS = [
  { id: "splunk", label: "Splunk SPL" }, { id: "sentinel", label: "Sentinel (KQL)" }, { id: "kql", label: "KQL" },
  { id: "elastic-dsl", label: "Elastic DSL" }, { id: "elastic-eql", label: "Elastic EQL" },
  { id: "qradar", label: "QRadar AQL" }, { id: "chronicle", label: "Chronicle YARA-L" }, { id: "loki", label: "Grafana Loki" },
];

export function RunArtifacts({ detectionPackId, useCases, references }: { detectionPackId: string | null; useCases: RichUseCase[]; references: RunRef[] }) {
  const [tab, setTab] = useState<Tab>("usecases");
  const [pack, setPack] = useState<PackDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = detectionPackId ? await fetch(`/api/detection-packs/${detectionPackId}`).then((r) => (r.ok ? r.json() : null)) : null;
        if (!cancelled) setPack(p);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [detectionPackId]);

  if (loading) return <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading artifacts…</div>;

  const rules = pack?.rules || [];
  const allSims = dedupe(useCases.flatMap((u) => u.simulations || []));
  const tabs: Array<{ key: Tab; label: string; icon: React.ElementType; count: number }> = [
    { key: "usecases", label: "Use Cases", icon: Shield, count: useCases.length },
    { key: "rules", label: "Detection Rules", icon: FileCode, count: rules.length },
    { key: "simulations", label: "Simulations", icon: Swords, count: allSims.length },
    { key: "references", label: "References", icon: Link2, count: references.length },
  ];

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px", tab === t.key ? "text-accent border-accent" : "text-muted-foreground border-transparent hover:text-foreground")}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
            <span className="ml-1 rounded-full bg-card-hover px-1.5 py-0.5 text-[10px] text-muted">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="p-3.5 space-y-3 max-h-[640px] overflow-y-auto">
        {tab === "usecases" && (useCases.length ? useCases.map((u, i) => <UseCaseCard key={u.id || i} uc={u} />) : <Empty>No use cases generated.</Empty>)}
        {tab === "rules" && (rules.length ? rules.map((r) => <RuleCard key={r.id} rule={r} />) : <Empty>No detection rules generated.</Empty>)}
        {tab === "simulations" && (allSims.length ? allSims.map((s, i) => <SimCard key={i} sim={s} />) : <Empty>No simulations available.</Empty>)}
        {tab === "references" && (references.length ? <RefList refs={references} /> : <Empty>No references captured.</Empty>)}
      </div>
    </div>
  );
}

function dedupe(sims: SimEntry[]): SimEntry[] {
  const seen = new Set<string>(); const out: SimEntry[] = [];
  for (const s of sims) { const k = `${s.source}:${s.techniqueId}:${s.name}`; if (seen.has(k)) continue; seen.add(k); out.push(s); }
  return out;
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="py-8 text-center text-xs text-muted-foreground">{children}</div>; }

function UseCaseCard({ uc }: { uc: RichUseCase }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card-hover/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left">
        <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted transition-transform", open && "rotate-90")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{uc.name}</span>
            {uc.id && <a href={`/use-cases/${uc.id}`} onClick={(e) => e.stopPropagation()} className="text-muted hover:text-accent" title="Open use case"><ExternalLink className="h-3 w-3" /></a>}
          </div>
          {uc.detectionObjective && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{uc.detectionObjective}</p>}
          <div className="mt-1 flex flex-wrap gap-1">
            {(uc.mitreTechniques || []).map((t) => <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono text-accent">{t}</span>)}
            {uc.simulations?.length ? <span className="rounded bg-purple/10 px-1.5 py-0.5 text-[10px] text-purple">{uc.simulations.length} sim</span> : null}
          </div>
        </div>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-border p-3 text-[11px]">
          {uc.scenarioDescription && <Field label="Scenario">{uc.scenarioDescription}</Field>}
          {uc.logSources?.length ? <Field label="Required log sources"><div className="flex flex-wrap gap-1">{uc.logSources.map((l, i) => <span key={i} className="rounded bg-card-hover px-1.5 py-0.5 text-muted-foreground">{l}</span>)}</div></Field> : null}
          {uc.detectionLogic && <Field label="Detection logic">{uc.detectionLogic}</Field>}
          {uc.steps?.length ? (
            <Field label="Kill-chain steps">
              <ol className="space-y-0.5">{uc.steps.map((s, i) => <li key={i}><span className="text-muted">{s.order}.</span> <span className="text-foreground">{s.name}</span> {s.techniqueId && <span className="font-mono text-[10px] text-accent">{s.techniqueId}</span>}{s.expectedSignal && <span className="block ml-3 text-muted">→ {s.expectedSignal}</span>}</li>)}</ol>
            </Field>
          ) : null}
          {uc.validationProcedure && <Field label="Validation procedure">{uc.validationProcedure}</Field>}
          {uc.expectedAlerts?.length ? <Field label="Expected alerts"><ul className="ml-4 list-disc">{uc.expectedAlerts.map((a, i) => <li key={i}>{a}</li>)}</ul></Field> : null}
          {uc.simulations?.length ? <Field label="Simulations"><div className="space-y-2">{uc.simulations.map((s, i) => <SimCard key={i} sim={s} />)}</div></Field> : null}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">{label}</div><div className="text-muted-foreground leading-snug">{children}</div></div>;
}

function RuleCard({ rule }: { rule: PackRule }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("splunk");
  const [converting, setConverting] = useState(false);
  const [conv, setConv] = useState<{ label: string; query?: string; error?: string; installHint?: string } | null>(null);
  const val = VAL_STATUS[rule.validationStatus] || VAL_STATUS.unvalidated;
  const isSigma = rule.format === "sigma";

  const convert = async () => {
    setConverting(true); setConv(null);
    try {
      const r = await fetch("/api/sigmagen/convert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sigma: rule.body, target }) });
      const d = await r.json();
      setConv({ label: d.label || target, query: d.success ? d.query : undefined, error: d.success ? undefined : (d.error || "conversion failed"), installHint: d.installHint });
    } catch (e) { setConv({ label: target, error: (e as Error).message }); }
    finally { setConverting(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-card-hover/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-90")} />
        <span className="flex-1 text-xs font-medium text-foreground">{rule.title}</span>
        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">{rule.format}</span>
        <Badge variant="status" status={val.status} size="sm">{val.label}</Badge>
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-2">
          <CodeBlock code={rule.body} language={rule.language || rule.format} showLineNumbers={false} />
          {rule.validationNotes && <p className="text-[11px] text-muted-foreground"><span className="font-medium">Validation:</span> {rule.validationNotes}</p>}
          {rule.falsePositives?.length > 0 && <div className="text-[11px] text-muted-foreground"><span className="font-medium">False positives:</span><ul className="ml-4 list-disc">{rule.falsePositives.map((fp, i) => <li key={i}>{fp}</li>)}</ul></div>}
          {isSigma && (
            <div className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-2">
                <Repeat className="h-3.5 w-3.5 text-accent" />
                <span className="text-[11px] font-medium text-foreground">Convert to SIEM:</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-7 rounded border border-border bg-input px-2 text-[11px] text-foreground focus:outline-none">
                  {CONVERT_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <button onClick={convert} disabled={converting} className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50">
                  {converting ? "Converting…" : "Convert"}
                </button>
              </div>
              {conv && (
                <div className="mt-2">
                  {conv.query ? <CodeBlock code={conv.query} language={conv.label} showLineNumbers={false} />
                    : <div className="rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">{conv.error}{conv.installHint && <span className="block text-muted mt-0.5">{conv.installHint}</span>}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SimCard({ sim }: { sim: SimEntry }) {
  const isCustom = sim.source === "custom";
  return (
    <div className="rounded-lg border border-border bg-card-hover/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", isCustom ? "bg-warning/10 text-warning" : "bg-purple/10 text-purple")}>{FW_LABEL[sim.source] || sim.source}</span>
        <span className="text-[10px] font-mono text-muted">{sim.techniqueId}</span>
        <span className="flex-1 text-xs font-medium text-foreground truncate">{sim.name}</span>
        {sim.executor && <span className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] text-muted">{sim.executor}</span>}
      </div>
      {(sim.description || sim.rationale) && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sim.description || sim.rationale}</p>}
      {isCustom && sim.command && (
        <div className="mt-1.5">
          <div className="flex items-center gap-1 text-[10px] text-muted mb-0.5"><Terminal className="h-3 w-3" /> Command</div>
          <CodeBlock code={sim.command} language={sim.executor || "bash"} showLineNumbers={false} />
          {sim.cleanupCommand && <><div className="mt-1 text-[10px] text-muted">Cleanup</div><CodeBlock code={sim.cleanupCommand} language={sim.executor || "bash"} showLineNumbers={false} /></>}
          {sim.expectedTelemetry && <p className="mt-1 text-[11px] text-muted-foreground"><span className="font-medium">Expected telemetry:</span> {sim.expectedTelemetry}</p>}
          {sim.prerequisites && <p className="text-[11px] text-muted"><span className="font-medium">Prerequisites:</span> {sim.prerequisites}</p>}
        </div>
      )}
    </div>
  );
}

function RefList({ refs }: { refs: RunRef[] }) {
  return (
    <ul className="space-y-1.5">
      {refs.map((r, i) => (
        <li key={i} className="flex items-start gap-2 text-[11px]">
          <Link2 className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
          <a href={r.url} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">{r.title || r.url}</a>
          <span className="shrink-0 rounded bg-card-hover px-1 text-[10px] text-muted">{r.type}</span>
        </li>
      ))}
    </ul>
  );
}
