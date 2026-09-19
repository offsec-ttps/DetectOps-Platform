"use client";

import { useState } from "react";
import { Plus, Save, X, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import StepCard, { type Step, type Framework } from "./StepCard";

function emptyStep(): Step {
  return { framework: "manual", displayName: "", parameters: {}, expectedSignal: "", notes: "" };
}

interface Props {
  packId: string;
  scenario: {
    id?: string;
    ordinal: number;
    name: string;
    description: string;
    steps: Step[];
    source?: string;
  };
  onSaved: (saved: any) => void;
  onCancel: () => void;
}

export default function ScenarioEditor({ packId, scenario, onSaved, onCancel }: Props) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description);
  const [steps, setSteps] = useState<Step[]>(scenario.steps?.length ? scenario.steps : [emptyStep()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStep = (i: number, patch: Partial<Step>) => {
    setSteps(steps.map((s, j) => (i === j ? { ...s, ...patch } : s)));
  };
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...steps];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setSteps(next);
  };
  const moveDown = (i: number) => {
    if (i === steps.length - 1) return;
    const next = [...steps];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    setSteps(next);
  };

  const save = async () => {
    if (!name.trim()) { setError("name is required"); return; }
    setSaving(true); setError(null);
    try {
      const isUpdate = !!scenario.id;
      const res = await fetch(
        isUpdate
          ? `/api/enterprise-use-cases/${packId}/scenarios/${scenario.id}`
          : `/api/enterprise-use-cases/${packId}/scenarios`,
        {
          method: isUpdate ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, steps }),
        },
      );
      const data = await res.json();
      if (!res.ok) { setError(data.error || "save failed"); return; }
      onSaved(data);
    } catch (err: any) {
      setError(err?.message || "save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <h3 className="text-xs font-semibold text-foreground">
          {scenario.id ? `Edit scenario #${scenario.ordinal}` : "New scenario"}
        </h3>
        <div className="ml-auto inline-flex items-center gap-2">
          <button onClick={onCancel} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 text-[11px] h-7 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save scenario
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 border-b border-danger/30 bg-danger/10 text-[11px] text-danger inline-flex items-center gap-2 w-full">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <div className="p-4 space-y-3">
        <Field label="Scenario name">
          <input
            type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ART coverage of LSASS dumping"
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What this scenario validates"
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </Field>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Steps ({steps.length})</span>
            <button
              onClick={() => setSteps([...steps, emptyStep()])}
              className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-accent/40"
            >
              <Plus className="h-3 w-3" /> Add step
            </button>
          </div>
          <div className="space-y-2">
            {steps.map((s, i) => (
              <StepCard
                key={i}
                step={s}
                index={i}
                isFirst={i === 0}
                isLast={i === steps.length - 1}
                onChange={(patch) => updateStep(i, patch)}
                onRemove={() => setSteps(steps.filter((_, j) => j !== i))}
                onUp={() => moveUp(i)}
                onDown={() => moveDown(i)}
              />
            ))}
            {steps.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4 italic">No steps yet — click "Add step".</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}
