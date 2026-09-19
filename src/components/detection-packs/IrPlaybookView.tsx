"use client";

import { useState } from "react";
import { Shield, AlertTriangle, Stethoscope, Pause, Trash2, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  order: number;
  title: string;
  action: string;
  expectedFinding: string;
  escalateIf?: string;
  references?: string[];
}

interface IrPlaybook {
  summary: string;
  l1Steps: Step[];
  l2Steps: Step[];
  l3Steps: Step[];
  containment: Step[];
  eradication: Step[];
  recovery: Step[];
}

const TABS = [
  { id: "l1",          label: "L1 — Triage",           Icon: Stethoscope, color: "text-info" },
  { id: "l2",          label: "L2 — Investigate",      Icon: AlertTriangle, color: "text-warning" },
  { id: "l3",          label: "L3 — Forensics",        Icon: Shield, color: "text-purple" },
  { id: "containment", label: "Containment",            Icon: Pause, color: "text-warning" },
  { id: "eradication", label: "Eradication",            Icon: Trash2, color: "text-danger" },
  { id: "recovery",    label: "Recovery",               Icon: RefreshCw, color: "text-success" },
] as const;

export default function IrPlaybookView({ irp }: { irp: IrPlaybook | null }) {
  const [tab, setTab] = useState<typeof TABS[number]["id"]>("l1");

  if (!irp) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-foreground">
        IR playbook was not produced for this pack (LLM error during generation).
      </div>
    );
  }

  const steps: Step[] = (
    tab === "l1" ? irp.l1Steps :
    tab === "l2" ? irp.l2Steps :
    tab === "l3" ? irp.l3Steps :
    tab === "containment" ? irp.containment :
    tab === "eradication" ? irp.eradication :
                            irp.recovery
  ) || [];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold text-foreground mb-1.5">Incident Response Playbook</h2>
        {irp.summary && <p className="text-xs text-muted-foreground">{irp.summary}</p>}
      </div>

      <div className="px-2 py-1.5 border-b border-border bg-background/30 flex items-center gap-0.5 flex-wrap">
        {TABS.map((t) => (
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
          </button>
        ))}
      </div>

      <div className="p-4 space-y-2">
        {steps.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No steps in this tier.</p>
        )}
        {steps.map((s, i) => (
          <div key={i} className="rounded-md border border-border bg-background/40 p-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">
                {String(s.order || i + 1).padStart(2, "0")}
              </span>
              <span className="text-xs font-semibold text-foreground flex-1">{s.title}</span>
            </div>
            {s.action && (
              <div className="mt-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</div>
                <p className="mt-0.5 text-[11px] text-foreground whitespace-pre-wrap">{s.action}</p>
              </div>
            )}
            {s.expectedFinding && (
              <div className="mt-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Expected finding</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.expectedFinding}</p>
              </div>
            )}
            {s.escalateIf && s.escalateIf.toLowerCase() !== "none" && (
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <ChevronRight className="h-3 w-3 text-warning flex-shrink-0" />
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-warning">Escalate if:</span>{" "}
                  <span className="text-[11px] text-warning">{s.escalateIf}</span>
                </div>
              </div>
            )}
            {Array.isArray(s.references) && s.references.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {s.references.map((r, j) => (
                  <a key={j} href={r} target="_blank" rel="noreferrer" className="text-[10px] text-accent hover:underline truncate max-w-[200px]">
                    {r}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
