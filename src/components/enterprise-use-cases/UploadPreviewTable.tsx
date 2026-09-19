"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import ValidationBadge, { type ValidationVerdict } from "./ValidationBadge";

export interface PreviewItem {
  sourceRowRef: string;
  name: string;
  description: string;
  detectionLogicPreview: string;
  severity: string;
  owner: string;
  platforms: string[];
  mitreTechniques: string[];
  validationStatus: ValidationVerdict;
  failedChecks?: Array<{ check: string; message: string; severity: string }>;
}

interface Props {
  items: PreviewItem[];
  parseErrors?: Array<{ row: string; message: string }>;
}

export default function UploadPreviewTable({ items, parseErrors = [] }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (ref: string) => {
    const next = new Set(expanded);
    if (next.has(ref)) next.delete(ref); else next.add(ref);
    setExpanded(next);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <FileCode2 className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">Preview · {items.length} use case{items.length !== 1 ? "s" : ""}</h3>
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          <span className="text-success">{items.filter((x) => x.validationStatus === "green").length} green</span>
          <span className="text-warning">{items.filter((x) => x.validationStatus === "yellow").length} yellow</span>
          <span className="text-danger">{items.filter((x) => x.validationStatus === "red").length} red</span>
        </div>
      </div>

      {parseErrors.length > 0 && (
        <div className="px-4 py-2 border-b border-warning/40 bg-warning/10 text-[11px] text-warning flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <strong>{parseErrors.length} parse error(s):</strong>
            <ul className="ml-3 mt-0.5 list-disc">
              {parseErrors.slice(0, 5).map((e, i) => (
                <li key={i}><span className="font-mono">{e.row}</span>: {e.message}</li>
              ))}
              {parseErrors.length > 5 && <li>… +{parseErrors.length - 5} more</li>}
            </ul>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No parsable use cases in this upload.
        </div>
      ) : (
        <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
          {items.map((it) => {
            const isOpen = expanded.has(it.sourceRowRef);
            return (
              <div key={it.sourceRowRef} className="px-4 py-2.5">
                <button onClick={() => toggle(it.sourceRowRef)} className="w-full text-left flex items-start gap-2">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground mt-0.5" /> : <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ValidationBadge status={it.validationStatus} />
                      <span className="font-mono text-[10px] text-muted-foreground">{it.sourceRowRef}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] uppercase border border-border bg-muted/10 text-muted-foreground">{it.severity}</span>
                      {it.owner && <span className="text-[10px] text-muted-foreground">owner: <span className="font-mono">{it.owner}</span></span>}
                    </div>
                    <div className="mt-1 text-sm font-medium text-foreground truncate">{it.name || <span className="italic text-muted-foreground">(no name)</span>}</div>
                    {it.description && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{it.description}</div>}
                  </div>
                </button>
                {isOpen && (
                  <div className="mt-2 ml-6 space-y-2">
                    {it.failedChecks && it.failedChecks.length > 0 && (
                      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-warning mb-1">Failed checks</div>
                        <ul className="text-[11px] text-warning list-disc ml-4">
                          {it.failedChecks.map((c, i) => <li key={i}>{c.message}</li>)}
                        </ul>
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">MITRE</div>
                      {it.mitreTechniques.length === 0
                        ? <span className="text-[11px] italic text-muted-foreground">none extracted</span>
                        : (
                          <div className="flex flex-wrap gap-1">
                            {it.mitreTechniques.map((t) => <span key={t} className="font-mono text-[10px] text-accent">{t}</span>)}
                          </div>
                        )
                      }
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Platforms</div>
                      <div className="text-[11px] font-mono">{it.platforms.length ? it.platforms.join(", ") : <span className="italic text-muted-foreground">none</span>}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Detection logic (preview)</div>
                      <pre className="text-[11px] font-mono text-foreground bg-background/60 border border-border rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
{it.detectionLogicPreview || <span className="italic text-muted-foreground">empty</span>}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
