"use client";

import { ShieldAlert, User, FileText, Calendar, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import ValidationBadge, { type ValidationVerdict } from "./ValidationBadge";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-danger/15 text-danger border-danger/40",
  high:     "bg-warning/15 text-warning border-warning/40",
  medium:   "bg-info/15 text-info border-info/40",
  low:      "bg-success/15 text-success border-success/40",
  info:     "bg-muted/15 text-muted-foreground border-border",
};

const STATUS_COLORS: Record<string, string> = {
  imported:           "bg-muted/15 text-muted-foreground border-border",
  mapped:             "bg-info/15 text-info border-info/40",
  "scenarios-defined":"bg-warning/15 text-warning border-warning/40",
  validated:          "bg-success/15 text-success border-success/40",
  promoted:           "bg-accent/15 text-accent border-accent/40",
  retired:            "bg-muted/15 text-muted-foreground border-border line-through",
};

interface Props {
  name: string;
  description: string;
  severity: string;
  status: string;
  validationStatus: ValidationVerdict;
  validationDetails?: any;
  format: string;
  owner: string;
  platforms: string[];
  mitreTechniques: string[];
  sourceFilename?: string | null;
  sourceRowRef?: string;
  lastValidatedAt?: string | Date | null;
  nextValidationDueAt?: string | Date | null;
  validationCadenceDays?: number;
  rightActions?: React.ReactNode;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

export default function EnterpriseUseCaseHeader(p: Props) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", SEVERITY_COLORS[p.severity] || SEVERITY_COLORS.info)}>
              {p.severity}
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", STATUS_COLORS[p.status] || STATUS_COLORS.imported)}>
              {p.status}
            </span>
            <ValidationBadge status={p.validationStatus} details={p.validationDetails} />
            <span className="rounded px-1.5 py-0.5 text-[10px] font-mono border border-border bg-muted/10 text-muted-foreground">
              format: {p.format || "unknown"}
            </span>
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-foreground">
            <ShieldAlert className="inline h-5 w-5 text-accent mr-1" />
            {p.name}
          </h1>
          {p.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-4">{p.description}</p>
          )}
        </div>
        {p.rightActions && <div className="flex-shrink-0">{p.rightActions}</div>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <FactCell icon={<User className="h-3 w-3" />} label="Owner">
          {p.owner || <span className="text-muted-foreground italic">unassigned</span>}
        </FactCell>
        <FactCell icon={<FileText className="h-3 w-3" />} label="Source">
          {p.sourceFilename ? (
            <span className="font-mono text-[10px]">{p.sourceFilename}{p.sourceRowRef ? ` · ${p.sourceRowRef}` : ""}</span>
          ) : <span className="text-muted-foreground italic">manual</span>}
        </FactCell>
        <FactCell icon={<ShieldAlert className="h-3 w-3" />} label="MITRE techniques">
          {p.mitreTechniques.length === 0
            ? <span className="text-muted-foreground italic">none</span>
            : (
              <div className="flex flex-wrap gap-1">
                {p.mitreTechniques.slice(0, 6).map((t) => (
                  <a key={t} href={`https://attack.mitre.org/techniques/${t.replace(".", "/")}/`} target="_blank" rel="noreferrer"
                    className="font-mono text-[10px] text-accent hover:underline">{t}</a>
                ))}
                {p.mitreTechniques.length > 6 && <span className="text-[10px] text-muted-foreground">+{p.mitreTechniques.length - 6}</span>}
              </div>
            )
          }
        </FactCell>
        <FactCell icon={<Activity className="h-3 w-3" />} label="Platforms">
          {p.platforms.length === 0
            ? <span className="text-muted-foreground italic">none</span>
            : <span className="font-mono">{p.platforms.slice(0, 4).join(", ")}{p.platforms.length > 4 ? ` +${p.platforms.length - 4}` : ""}</span>
          }
        </FactCell>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground border-t border-border pt-2">
        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Last validated: {fmtDate(p.lastValidatedAt)}</span>
        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Next due: {fmtDate(p.nextValidationDueAt)}</span>
        <span>Cadence: {p.validationCadenceDays || 365} days</span>
      </div>
    </div>
  );
}

function FactCell({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xs text-foreground">{children}</div>
    </div>
  );
}
