"use client";

import { useState } from "react";
import { Check, Copy, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Rule {
  id: string;
  format: string;
  title: string;
  body: string;
  language: string;
  validationStatus: string;
  falsePositives: string[];
}

const FORMAT_COLORS: Record<string, string> = {
  "sigma":           "border-warning/50 text-warning",
  "spl":             "border-purple/50 text-purple",
  "kql":             "border-info/50 text-info",
  "elastic-eql":     "border-success/50 text-success",
  "elastic-lucene":  "border-success/50 text-success",
  "yara":            "border-danger/50 text-danger",
  "falco":           "border-accent/50 text-accent",
  "wazuh":           "border-accent/50 text-accent",
};

export default function RuleTabs({ rules }: { rules: Rule[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  if (!rules.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <FileCode2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No detection rules emitted for this pack.</p>
      </div>
    );
  }
  const r = rules[active];
  const copy = async () => {
    await navigator.clipboard.writeText(r.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {rules.map((x, i) => (
            <button
              key={x.id}
              onClick={() => setActive(i)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-mono uppercase border transition-colors",
                i === active
                  ? FORMAT_COLORS[x.format] || "border-accent/50 text-accent"
                  : "border-border text-muted-foreground hover:text-foreground",
                i === active && "bg-card-hover",
              )}
              title={x.title}
            >
              {x.format}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="px-4 py-2 border-b border-border bg-background/30">
        <div className="text-xs font-semibold text-foreground">{r.title}</div>
        {r.language && <div className="text-[10px] text-muted-foreground mt-0.5">language: <span className="font-mono">{r.language}</span></div>}
      </div>
      <pre className="px-4 py-3 text-[11px] font-mono text-foreground bg-background/60 overflow-x-auto whitespace-pre-wrap break-words max-h-[480px] overflow-y-auto">
{r.body}
      </pre>
      {r.falsePositives.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-background/30">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Known false positives</div>
          <ul className="mt-1 text-[11px] text-muted-foreground list-disc ml-4">
            {r.falsePositives.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
