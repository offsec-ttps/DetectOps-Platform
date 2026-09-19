"use client";

import { useEffect, useState } from "react";
import {
  Play, Loader2, X, AlertTriangle, ShieldAlert, Server, Cloud, Cpu, GitBranch, CheckCircle2,
  Calendar, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import PreflightPanel from "./PreflightPanel";

interface Scenario { id: string; ordinal: number; name: string; steps: { framework: string }[]; source: string }
interface EnvRow { id: string; name: string; kind: string; enabled: boolean }

interface Props {
  packId: string;
  scenarios: Scenario[];
  defaultScenarioId?: string;
  selectedLogicChoice: "original" | "recommended" | "edited";
  onClose: () => void;
  onCompleted: (runResult: any) => void;
}

const ENV_KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  "our-template-deployed": Server, "user-cloud": Cloud, agent: Cpu, shell: GitBranch,
};

export default function RunDialog({ packId, scenarios, defaultScenarioId, selectedLogicChoice, onClose, onCompleted }: Props) {
  const [scenarioId, setScenarioId] = useState<string>(defaultScenarioId || scenarios[0]?.id || "");
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [mode, setMode] = useState<"simulate-only" | "simulate-and-validate">("simulate-only");
  const [testedLogicChoice, setTestedLogicChoice] = useState<"original" | "recommended" | "edited">(selectedLogicChoice);
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [envs, setEnvs] = useState<EnvRow[]>([]);
  const [loadingEnvs, setLoadingEnvs] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<"immediate" | "draft" | "scheduled">("immediate");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [preflightVerdict, setPreflightVerdict] = useState<"green" | "yellow" | "red" | "pending">("pending");
  const [preflightRunnable, setPreflightRunnable] = useState(true);

  useEffect(() => {
    setLoadingEnvs(true);
    fetch("/api/environment-targets?enabled=true")
      .then((r) => r.json())
      .then((d) => setEnvs((d.items || []).filter((e: EnvRow) => e.enabled)))
      .catch(() => setEnvs([]))
      .finally(() => setLoadingEnvs(false));
  }, []);

  const selectedEnv = envs.find((e) => e.id === environmentId);
  const isDestructive = (selectedEnv?.kind === "user-cloud" || selectedEnv?.kind === "shell") && mode === "simulate-and-validate";

  // Default scheduledFor to 5 min in the future when switching to scheduled mode
  useEffect(() => {
    if (runMode === "scheduled" && !scheduledFor) {
      const d = new Date(Date.now() + 5 * 60_000);
      setScheduledFor(d.toISOString().slice(0, 16));
    }
  }, [runMode, scheduledFor]);

  const canRun = !!scenarioId && !!environmentId && (!isDestructive || confirmDestructive) && !running &&
    (runMode === "draft" || preflightRunnable) &&
    (runMode !== "scheduled" || !!scheduledFor);

  const run = async () => {
    setRunning(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        scenarioId, environmentId, mode, testedLogicChoice, confirmDestructive,
        runMode,
      };
      if (runMode === "scheduled" && scheduledFor) {
        body.scheduledFor = new Date(scheduledFor).toISOString();
      }
      const res = await fetch(`/api/enterprise-use-cases/${packId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "run failed"); return; }
      onCompleted(data);
    } catch (err: any) {
      setError(err?.message || "run failed");
    } finally { setRunning(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Play className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">Run scenario</h2>
          <button onClick={onClose} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 border-b border-danger/30 bg-danger/10 text-xs text-danger inline-flex items-center gap-2 w-full">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        )}

        <div className="p-5 space-y-4">
          {/* Scenario */}
          <Field label="Scenario" required>
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
              {scenarios.length === 0 && <option value="">(no scenarios defined)</option>}
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  #{String(s.ordinal).padStart(2, "0")} · {s.name} · {s.steps.length} step(s)
                </option>
              ))}
            </select>
          </Field>

          {/* Environment */}
          <Field label="Environment" required>
            {loadingEnvs ? (
              <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
            ) : envs.length === 0 ? (
              <div className="rounded border border-dashed border-border bg-card/30 p-3 text-center text-xs text-muted-foreground">
                No enabled environments. Create one at <a href="/detections/enterprise/environments" className="text-accent hover:underline">/detections/enterprise/environments</a>.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {envs.map((e) => {
                  const Icon = ENV_KIND_ICON[e.kind] || Server;
                  const sel = environmentId === e.id;
                  return (
                    <button
                      key={e.id}
                      onClick={() => setEnvironmentId(e.id)}
                      className={cn(
                        "text-left rounded-md border px-3 py-2 transition-colors",
                        sel ? "border-accent bg-accent/10" : "border-border bg-background/40 hover:border-accent/40",
                      )}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <Icon className={cn("h-3.5 w-3.5", sel ? "text-accent" : "text-muted-foreground")} />
                        <span className="text-xs font-semibold text-foreground">{e.name}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{e.kind}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {/* Mode */}
          <Field label="Run mode" required>
            <div className="grid grid-cols-2 gap-2">
              <ModePick selected={mode === "simulate-only"} onClick={() => setMode("simulate-only")}
                title="Simulate only"
                blurb="Execute scenario steps. No SIEM coverage query."
              />
              <ModePick selected={mode === "simulate-and-validate"} onClick={() => setMode("simulate-and-validate")}
                title="Simulate + validate"
                blurb="Execute steps, then query the configured SIEM to verify the rule fired."
              />
            </div>
          </Field>

          {/* Logic choice */}
          <Field label="Test which logic body?">
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {(["original", "recommended", "edited"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setTestedLogicChoice(c)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium",
                    testedLogicChoice === c ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c}
                  {c === selectedLogicChoice && <CheckCircle2 className="inline-block ml-1 h-3 w-3 text-success" />}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Defaults to the currently-selected logic. Use this to A/B-test recommended vs. original under attack.
            </p>
          </Field>

          {/* Preflight */}
          {scenarioId && environmentId && (
            <PreflightPanel
              packId={packId}
              scenarioId={scenarioId}
              environmentId={environmentId}
              mode={mode}
              onResult={(r) => { setPreflightVerdict(r.verdict); setPreflightRunnable(r.runnable); }}
            />
          )}

          {/* Destructive gate */}
          {isDestructive && (
            <div className="rounded border border-danger/40 bg-danger/5 px-3 py-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-danger font-semibold uppercase">
                <ShieldAlert className="h-3.5 w-3.5" /> Destructive run
              </div>
              <p className="text-[11px] text-foreground mt-1">
                {selectedEnv?.kind === "user-cloud"
                  ? "User-cloud Stratus steps may create live cloud resources and bill against your account."
                  : "Shell payload delivery will execute on a real listener target."}
              </p>
              <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
                <input type="checkbox" checked={confirmDestructive} onChange={(e) => setConfirmDestructive(e.target.checked)} className="accent-danger" />
                I understand and confirm this destructive run
              </label>
            </div>
          )}

          {/* Execution mode */}
          <Field label="Execution mode">
            <div className="grid grid-cols-3 gap-1.5">
              {(["immediate", "draft", "scheduled"] as const).map((m) => {
                const Icon = m === "immediate" ? Play : m === "draft" ? Save : Calendar;
                const label = m === "immediate" ? "Execute now" : m === "draft" ? "Save draft" : "Schedule";
                const blurb = m === "immediate" ? "Run synchronously now."
                  : m === "draft" ? "Persist as a queued draft to run later by hand."
                  : "Run automatically at a future date/time.";
                return (
                  <button key={m} onClick={() => setRunMode(m)} className={cn(
                    "text-left rounded-md border px-2.5 py-1.5 transition-colors",
                    runMode === m ? "border-accent bg-accent/10" : "border-border bg-background/40 hover:border-accent/40",
                  )}>
                    <div className="inline-flex items-center gap-1.5">
                      <Icon className={cn("h-3 w-3", runMode === m ? "text-accent" : "text-muted-foreground")} />
                      <span className="text-[11px] font-semibold text-foreground">{label}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{blurb}</div>
                  </button>
                );
              })}
            </div>
            {runMode === "scheduled" && (
              <div className="mt-2">
                <label className="block">
                  <span className="text-[10px] text-muted-foreground mb-0.5 block">Scheduled for (local time)</span>
                  <input
                    type="datetime-local"
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
                    className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
                  />
                </label>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Scheduled runs fire when <code>POST /api/enterprise-use-cases/runs/tick</code> is invoked AFTER this time.
                </p>
              </div>
            )}
          </Field>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="inline-flex items-center gap-1 text-xs h-8 px-3 rounded border border-border text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            onClick={run}
            disabled={!canRun}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs h-8 px-4 rounded text-white disabled:opacity-50",
              runMode === "immediate" ? "bg-accent hover:bg-[#60a5fa]"
                : runMode === "draft" ? "bg-info hover:opacity-90"
                : "bg-warning hover:opacity-90",
            )}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" />
              : runMode === "immediate" ? <Play className="h-3 w-3" />
              : runMode === "draft" ? <Save className="h-3 w-3" />
              : <Calendar className="h-3 w-3" />}
            {running ? "Working…"
              : runMode === "immediate" ? "Execute now"
              : runMode === "draft" ? "Save draft"
              : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block font-semibold">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function ModePick({ selected, onClick, title, blurb }: { selected: boolean; onClick: () => void; title: string; blurb: string }) {
  return (
    <button onClick={onClick} className={cn(
      "text-left rounded-md border px-3 py-2 transition-colors",
      selected ? "border-accent bg-accent/10" : "border-border bg-background/40 hover:border-accent/40",
    )}>
      <div className="text-xs font-semibold text-foreground">{title}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{blurb}</div>
    </button>
  );
}
