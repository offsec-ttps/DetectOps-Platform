"use client";

import { useEffect, useState } from "react";
import {
  Shield, AlertTriangle, Stethoscope, Pause, Trash2, RefreshCw,
  Plus, ChevronUp, ChevronDown, X, Save, Loader2, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  order: number;
  title: string;
  action: string;
  expectedFinding: string;
  escalateIf?: string;
  references?: string[];
}

export interface IrPlaybook {
  summary: string;
  l1Steps: Step[];
  l2Steps: Step[];
  l3Steps: Step[];
  containment: Step[];
  eradication: Step[];
  recovery: Step[];
}

const TABS = [
  { id: "l1Steps",     label: "L1 — Triage",      Icon: Stethoscope,   color: "text-info"    },
  { id: "l2Steps",     label: "L2 — Investigate", Icon: AlertTriangle, color: "text-warning" },
  { id: "l3Steps",     label: "L3 — Forensics",   Icon: Shield,        color: "text-purple"  },
  { id: "containment", label: "Containment",       Icon: Pause,         color: "text-warning" },
  { id: "eradication", label: "Eradication",       Icon: Trash2,        color: "text-danger"  },
  { id: "recovery",    label: "Recovery",          Icon: RefreshCw,     color: "text-success" },
] as const;

type TabId = typeof TABS[number]["id"];

function emptyStep(order: number): Step {
  return { order, title: "", action: "", expectedFinding: "", escalateIf: "none", references: [] };
}

function reorder(steps: Step[]): Step[] {
  return steps.map((s, i) => ({ ...s, order: i + 1 }));
}

interface Props {
  packId: string;
  initialIrp: IrPlaybook | null;
  /** Called with the saved IRP after a successful PATCH so the parent can refresh. */
  onSaved?: (irp: IrPlaybook) => void;
  /** Called when the user clicks Cancel — parent should restore read-only view. */
  onCancel?: () => void;
}

export default function IrPlaybookEditor({ packId, initialIrp, onSaved, onCancel }: Props) {
  const [tab, setTab] = useState<TabId>("l1Steps");
  const [draft, setDraft] = useState<IrPlaybook>(() => initialIrp || {
    summary: "", l1Steps: [], l2Steps: [], l3Steps: [],
    containment: [], eradication: [], recovery: [],
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => { setDirty(false); }, [packId]);

  const steps: Step[] = draft[tab];

  const mutateSteps = (next: Step[]) => {
    setDraft((prev) => ({ ...prev, [tab]: reorder(next) }));
    setDirty(true);
  };
  const updateStep = (i: number, patch: Partial<Step>) => {
    const next = steps.map((s, j) => (i === j ? { ...s, ...patch } : s));
    mutateSteps(next);
  };
  const addStep = () => mutateSteps([...steps, emptyStep(steps.length + 1)]);
  const removeStep = (i: number) => mutateSteps(steps.filter((_, j) => j !== i));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...steps];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    mutateSteps(next);
  };
  const moveDown = (i: number) => {
    if (i === steps.length - 1) return;
    const next = [...steps];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    mutateSteps(next);
  };

  const save = async () => {
    setSaving(true); setError(null); setFlash(null);
    try {
      const body: Partial<IrPlaybook> = {
        summary: draft.summary,
        l1Steps: draft.l1Steps,
        l2Steps: draft.l2Steps,
        l3Steps: draft.l3Steps,
        containment: draft.containment,
        eradication: draft.eradication,
        recovery: draft.recovery,
      };
      const res = await fetch(`/api/detection-packs/${packId}/ir-playbook`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Save failed"); return; }
      setDirty(false);
      setFlash(`Saved (${data.updatedTiers?.length || 0} tiers updated)`);
      onSaved?.(draft);
      setTimeout(() => setFlash(null), 2500);
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <h2 className="text-xs font-semibold text-foreground">Incident Response Playbook (editing)</h2>
          <div className="flex items-center gap-2">
            {flash && <span className="text-[10px] text-success inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {flash}</span>}
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>
        <textarea
          value={draft.summary}
          onChange={(e) => { setDraft({ ...draft, summary: e.target.value }); setDirty(true); }}
          placeholder="One paragraph framing the incident for the on-call analyst…"
          rows={2}
          className="mt-2 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
      </div>

      <div className="px-2 py-1.5 border-b border-border bg-background/30 flex items-center gap-0.5 flex-wrap">
        {TABS.map((t) => {
          const count = (draft[t.id] || []).length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors",
                tab === t.id
                  ? "bg-card text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground border border-transparent",
              )}
            >
              <t.Icon className={cn("h-3 w-3", tab === t.id ? t.color : "")} />
              {t.label}
              <span className="font-mono text-[9px] text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="p-4 space-y-2">
        {steps.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No steps in this tier yet. Click "Add step" below.</p>
        )}
        {steps.map((s, i) => (
          <StepCard
            key={i}
            step={s}
            index={i}
            isFirst={i === 0}
            isLast={i === steps.length - 1}
            onChange={(patch) => updateStep(i, patch)}
            onRemove={() => removeStep(i)}
            onUp={() => moveUp(i)}
            onDown={() => moveDown(i)}
          />
        ))}
        <button
          onClick={addStep}
          className="inline-flex items-center gap-1.5 text-[11px] h-7 px-3 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-accent/40"
        >
          <Plus className="h-3 w-3" /> Add step
        </button>
      </div>
    </div>
  );
}

function StepCard({
  step, index, isFirst, isLast, onChange, onRemove, onUp, onDown,
}: {
  step: Step;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const [refDraft, setRefDraft] = useState("");
  const refs = step.references || [];

  return (
    <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{String(step.order || index + 1).padStart(2, "0")}</span>
        <input
          type="text" value={step.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Imperative one-line title (e.g. Acknowledge alert)"
          className="flex-1 px-1.5 py-1 text-[11px] font-semibold rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
        <button onClick={onUp} disabled={isFirst} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25" title="Move up"><ChevronUp className="h-3 w-3" /></button>
        <button onClick={onDown} disabled={isLast} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25" title="Move down"><ChevronDown className="h-3 w-3" /></button>
        <button onClick={onRemove} className="p-0.5 text-danger hover:bg-danger/10 rounded" title="Remove step"><Trash2 className="h-3 w-3" /></button>
      </div>

      <Field label="Action">
        <textarea
          value={step.action} rows={3}
          onChange={(e) => onChange({ action: e.target.value })}
          placeholder="Concrete commands / UI clicks. Name the tool, the query, the command."
          className="w-full px-2 py-1 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
      </Field>
      <Field label="Expected finding">
        <textarea
          value={step.expectedFinding} rows={2}
          onChange={(e) => onChange({ expectedFinding: e.target.value })}
          placeholder="What the analyst should see / record."
          className="w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
      </Field>
      <Field label="Escalate if">
        <input
          type="text" value={step.escalateIf || ""}
          onChange={(e) => onChange({ escalateIf: e.target.value })}
          placeholder='"none" if no escalation; otherwise the hand-off condition'
          className="w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
      </Field>
      <Field label="References">
        <div className="space-y-1">
          {refs.map((r, j) => (
            <div key={j} className="flex items-center gap-1">
              <input
                type="text" value={r} readOnly
                className="flex-1 px-1.5 py-1 text-[11px] font-mono rounded border border-border bg-background text-foreground"
              />
              <button onClick={() => onChange({ references: refs.filter((_, k) => k !== j) })} className="p-0.5 text-danger hover:bg-danger/10 rounded">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <input
              type="text" value={refDraft}
              onChange={(e) => setRefDraft(e.target.value)}
              placeholder="https://runbook.local/lsass-triage"
              className="flex-1 px-1.5 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => {
                if (!refDraft.trim()) return;
                onChange({ references: [...refs, refDraft.trim()].slice(0, 10) });
                setRefDraft("");
              }}
              className="p-0.5 text-accent hover:bg-accent/10 rounded"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      {children}
    </div>
  );
}
