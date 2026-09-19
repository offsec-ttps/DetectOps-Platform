"use client";

import { useState } from "react";
import {
  FlaskConical, FileCode2, Cloud, Terminal, Cpu, Network, GitBranch, X, ChevronUp, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type Framework =
  | "atomic" | "purplesharp" | "stratus"
  | "manual" | "reverse-shell" | "bind-shell" | "agent";

export interface Step {
  framework: Framework;
  refId?: string;
  techniqueId?: string;
  displayName: string;
  parameters: Record<string, unknown>;
  expectedSignal?: string;
  notes?: string;
}

const FRAMEWORK_META: Record<Framework, { label: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  atomic:        { label: "ART",         Icon: FlaskConical, color: "border-accent/40 text-accent"    },
  purplesharp:   { label: "PurpleSharp", Icon: FileCode2,    color: "border-purple/40 text-purple"    },
  stratus:       { label: "Stratus",     Icon: Cloud,        color: "border-info/40 text-info"        },
  manual:        { label: "Manual",      Icon: Terminal,     color: "border-muted/40 text-muted-foreground" },
  "reverse-shell": { label: "Reverse Shell", Icon: GitBranch, color: "border-warning/40 text-warning" },
  "bind-shell":  { label: "Bind Shell",   Icon: Network,      color: "border-warning/40 text-warning"  },
  agent:         { label: "Agent",       Icon: Cpu,          color: "border-info/40 text-info"        },
};

const FRAMEWORKS: Framework[] = ["atomic", "purplesharp", "stratus", "manual", "reverse-shell", "bind-shell", "agent"];

interface Props {
  step: Step;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Step>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}

export default function StepCard({ step, index, isFirst, isLast, onChange, onRemove, onUp, onDown }: Props) {
  const meta = FRAMEWORK_META[step.framework] || FRAMEWORK_META.manual;
  return (
    <div className={cn("rounded-md border bg-background/40 p-3 space-y-2", meta.color)}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
        <select
          value={step.framework}
          onChange={(e) => onChange({ framework: e.target.value as Framework })}
          className="px-1.5 py-0.5 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono"
        >
          {FRAMEWORKS.map((f) => <option key={f} value={f}>{FRAMEWORK_META[f].label}</option>)}
        </select>
        {step.techniqueId && (
          <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded border", meta.color)}>{step.techniqueId}</span>
        )}
        <input
          type="text" value={step.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
          placeholder="Step display name"
          className="flex-1 px-1.5 py-0.5 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
        />
        <button onClick={onUp} disabled={isFirst} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25" title="Move up"><ChevronUp className="h-3 w-3" /></button>
        <button onClick={onDown} disabled={isLast} className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25" title="Move down"><ChevronDown className="h-3 w-3" /></button>
        <button onClick={onRemove} className="p-0.5 text-danger hover:bg-danger/10 rounded"><X className="h-3 w-3" /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Technique ID">
          <input
            type="text" value={step.techniqueId || ""}
            onChange={(e) => onChange({ techniqueId: e.target.value })}
            placeholder="T1059.001"
            className="w-full px-1.5 py-0.5 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </Field>
        <Field label={`Ref id ${step.framework === "atomic" ? "(ART test GUID)" : step.framework === "purplesharp" ? "(PS variation id)" : step.framework === "stratus" ? "(Stratus attack id)" : ""}`}>
          <input
            type="text" value={step.refId || ""}
            onChange={(e) => onChange({ refId: e.target.value })}
            placeholder="optional"
            className="w-full px-1.5 py-0.5 text-[11px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </Field>
      </div>

      <ParametersField step={step} onChange={(p) => onChange({ parameters: p })} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Expected signal">
          <input
            type="text" value={step.expectedSignal || ""}
            onChange={(e) => onChange({ expectedSignal: e.target.value })}
            placeholder="Sysmon EID 1 / 4624 / CloudTrail event…"
            className="w-full px-1.5 py-0.5 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </Field>
        <Field label="Notes">
          <input
            type="text" value={step.notes || ""}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="Rationale / tuning hints"
            className="w-full px-1.5 py-0.5 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}

function ParametersField({ step, onChange }: { step: Step; onChange: (p: Record<string, unknown>) => void }) {
  const [text, setText] = useState<string>(JSON.stringify(step.parameters || {}, null, 2));
  const [err, setErr] = useState<string | null>(null);

  return (
    <div>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5 block">Parameters (JSON)</span>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try { onChange(JSON.parse(e.target.value || "{}")); setErr(null); }
          catch (er: any) { setErr(er.message); }
        }}
        rows={3}
        spellCheck={false}
        className="w-full px-1.5 py-1 text-[10px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
      />
      {err && <p className="mt-1 text-[10px] text-danger">JSON parse error: {err}</p>}
    </div>
  );
}
