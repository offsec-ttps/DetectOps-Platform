"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Shield, Download, ExternalLink, ArrowLeft, Copy, Check, Tag,
  User, Calendar, AlertTriangle, FileCode2, Loader2, Sparkles, Pencil, Trash2,
  BookOpen, Clock,
} from "lucide-react";
import GenerateFromRuleButton from "@/components/use-cases/GenerateFromRuleButton";
import GenerateDetectionPackButton from "@/components/detection-packs/GenerateButton";

interface SigmaRuleDetail {
  id: string;
  sigmaId: string | null;
  title: string;
  description: string;
  status: string;
  level: string;
  tags: string[];
  logsourceCategory: string;
  logsourceProduct: string;
  logsourceService: string;
  detectionYaml: string;
  filePath: string;
  repositoryUrl: string;
  author: string;
  date: string;
  modified: string;
  falsepositives: string[];
  references: string[];
  mitreTechniques: string[];
  changeStatus: string;
  importStatus: string;
  createdAt: string;
  updatedAt: string;
  upstreamLastModifiedAt: string | null;
}

const levelColors: Record<string, string> = {
  critical: "text-severity-critical bg-severity-critical/10 border-severity-critical/30",
  high: "text-severity-high bg-severity-high/10 border-severity-high/30",
  medium: "text-severity-medium bg-severity-medium/10 border-severity-medium/30",
  low: "text-severity-low bg-severity-low/10 border-severity-low/30",
  informational: "text-info bg-info/10 border-info/30",
};

const statusColors: Record<string, string> = {
  stable: "text-success bg-success/10 border-success/30",
  test: "text-accent bg-accent/10 border-accent/30",
  experimental: "text-warning bg-warning/10 border-warning/30",
  deprecated: "text-danger bg-danger/10 border-danger/30",
};

const changeBadge: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: "New", color: "text-success bg-success/10 border-success/30", icon: Sparkles },
  modified: { label: "Modified", color: "text-warning bg-warning/10 border-warning/30", icon: Pencil },
  deleted: { label: "Deleted Upstream", color: "text-danger bg-danger/10 border-danger/30", icon: Trash2 },
  unchanged: { label: "Unchanged", color: "text-muted bg-muted/10 border-border", icon: Check },
};

export default function SigmaHQRuleDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [rule, setRule] = useState<SigmaRuleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"yaml" | "metadata">("yaml");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/community/sigmahq/rules/${id}`);
        if (res.ok) {
          setRule(await res.json());
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleCopy = () => {
    if (!rule) return;
    navigator.clipboard.writeText(rule.detectionYaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 animate-fade-in">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="text-center py-32 animate-fade-in">
        <Shield className="h-12 w-12 text-muted mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-foreground">Rule not found</h2>
        <Link href="/community/sigmahq" className="text-sm text-accent hover:underline mt-2 inline-block">Back to SigmaHQ rules</Link>
      </div>
    );
  }

  const change = changeBadge[rule.changeStatus] || changeBadge.unchanged;
  const ChangeIcon = change.icon;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb + back */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/community" className="text-muted hover:text-accent transition-colors">Community</Link>
        <span className="text-muted">/</span>
        <Link href="/community/sigmahq" className="text-muted hover:text-accent transition-colors">SigmaHQ</Link>
        <span className="text-muted">/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">{rule.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{rule.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rule.description}</p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", levelColors[rule.level] || "text-muted border-border")}>
              {rule.level}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", statusColors[rule.status] || "text-muted border-border")}>
              {rule.status}
            </span>
            <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", change.color)}>
              <ChangeIcon className="h-2.5 w-2.5" /> {change.label}
            </span>
            {rule.sigmaId && (
              <span className="rounded bg-card-hover px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{rule.sigmaId}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <a
            href={`/api/community/sigmahq/rules/${rule.id}/download`}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors"
          >
            <Download className="h-4 w-4" /> Download YAML
          </a>
          <a
            href={rule.repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors"
          >
            <ExternalLink className="h-4 w-4" /> View on GitHub
          </a>
          <GenerateFromRuleButton
            sourceTable="CommunitySigmaRule"
            ruleId={rule.id}
            ruleTitle={rule.title}
          />
          <GenerateDetectionPackButton
            sourceType="rule"
            sourceTable="CommunitySigmaRule"
            ruleId={rule.id}
          />
          <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
            <Download className="h-4 w-4" /> Import to Org
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main content */}
        <div className="col-span-8 space-y-6">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border">
            {(["yaml", "metadata"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize", tab === t ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground")}>
                {t === "yaml" ? "Sigma Rule YAML" : "Metadata"}
              </button>
            ))}
          </div>

          {tab === "yaml" && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-4 w-4 text-accent" />
                  <span className="text-xs font-medium text-muted-foreground">{rule.filePath.split("/").pop()}</span>
                  <span className="text-[10px] text-muted">YAML</span>
                </div>
                <button onClick={handleCopy} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-card-hover transition-colors">
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="overflow-auto max-h-[600px]">
                <pre className="p-4 text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre">
                  {rule.detectionYaml}
                </pre>
              </div>
            </div>
          )}

          {tab === "metadata" && (
            <div className="space-y-4">
              {/* False Positives */}
              {rule.falsepositives.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" /> False Positives
                  </h3>
                  <ul className="space-y-1">
                    {rule.falsepositives.map((fp, i) => (
                      <li key={i} className="text-xs text-muted-foreground">• {fp}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* References */}
              {rule.references.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-accent" /> References
                  </h3>
                  <ul className="space-y-1">
                    {rule.references.map((ref, i) => (
                      <li key={i}>
                        <a href={ref} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline break-all">
                          {ref}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Log Source */}
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground mb-2">Log Source</h3>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: "Category", value: rule.logsourceCategory },
                    { label: "Product", value: rule.logsourceProduct },
                    { label: "Service", value: rule.logsourceService },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] font-semibold text-muted uppercase">{item.label}</p>
                      <p className="text-sm text-foreground">{item.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="col-span-4 space-y-4">
          {/* Quick Info */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted uppercase">Details</h3>
            {[
              { icon: User, label: "Author", value: rule.author || "Unknown" },
              { icon: Calendar, label: "Created", value: rule.date || "—" },
              { icon: Clock, label: "Modified", value: rule.modified || "—" },
              { icon: FileCode2, label: "File", value: rule.filePath.split("/").slice(-2).join("/") },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <item.icon className="h-3.5 w-3.5 text-muted mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] text-muted">{item.label}</p>
                  <p className="text-xs text-foreground">{item.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* MITRE ATT&CK Techniques */}
          {rule.mitreTechniques.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted uppercase mb-2">MITRE ATT&CK Techniques</h3>
              <div className="flex flex-wrap gap-1.5">
                {rule.mitreTechniques.map((t) => (
                  <span key={t} className="rounded bg-accent/10 px-2 py-0.5 text-xs font-mono font-bold text-accent">{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {rule.tags.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted uppercase mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {rule.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                    <Tag className="h-2.5 w-2.5" /> {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sync Info */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase">Sync Info</h3>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Change status</span>
              <span className={cn("flex items-center gap-1 font-medium", change.color.split(" ")[0])}>
                <ChangeIcon className="h-3 w-3" /> {change.label}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Import status</span>
              <span className="text-muted-foreground capitalize">{rule.importStatus.replace("_", " ")}</span>
            </div>
            {rule.upstreamLastModifiedAt && (
              <div className="flex justify-between text-xs">
                <span className="text-muted">Upstream modified</span>
                <span className="text-muted-foreground">{new Date(rule.upstreamLastModifiedAt).toLocaleDateString()}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-muted">Local updated</span>
              <span className="text-muted-foreground">{new Date(rule.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
