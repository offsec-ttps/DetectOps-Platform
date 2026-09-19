"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export function CodeBlock({ code, language, showLineNumbers = true, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split("\n");

  return (
    <div className={cn("relative rounded-lg border border-border bg-[#0d1117] overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-[#161b22] px-4 py-2">
        {language && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {language}
          </span>
        )}
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted hover:text-foreground transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* Code content */}
      <div className="overflow-x-auto p-4">
        <pre className="text-[13px] leading-relaxed font-mono">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {showLineNumbers && (
                <span className="mr-4 inline-block w-8 select-none text-right text-muted/50">
                  {i + 1}
                </span>
              )}
              <code className="text-muted-foreground">{line}</code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
