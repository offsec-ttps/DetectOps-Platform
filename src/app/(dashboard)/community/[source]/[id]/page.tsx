"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import {
  Shield, Download, ExternalLink, Tag, User, Calendar,
  AlertTriangle, FileCode2, Check, BookOpen, Copy,
  GitBranch, Loader2, Clock, Zap, Sparkles, Pencil, Trash2,
  Flame,
} from "lucide-react";
import GenerateFromRuleButton from "@/components/use-cases/GenerateFromRuleButton";
import GenerateDetectionPackButton from "@/components/detection-packs/GenerateButton";

const levelColors: Record<string, string> = {
  critical: "text-severity-critical bg-severity-critical/10 border-severity-critical/30",
  high: "text-severity-high bg-severity-high/10 border-severity-high/30",
  medium: "text-severity-medium bg-severity-medium/10 border-severity-medium/30",
  low: "text-severity-low bg-severity-low/10 border-severity-low/30",
  informational: "text-info bg-info/10 border-info/30",
};

const sourceColors: Record<string, string> = {
  splunk: "text-purple bg-purple/15 border-purple/30",
  elastic: "text-warning bg-warning/15 border-warning/30",
  "mitre-car": "text-purple bg-purple/15 border-purple/30",
  sentinel: "text-accent bg-accent/15 border-accent/30",
  "defender-xdr": "text-accent bg-accent/15 border-accent/30",
  "google-secops": "text-warning bg-warning/15 border-warning/30",
  panther: "text-success bg-success/15 border-success/30",
  falco: "text-danger bg-danger/15 border-danger/30",
  wazuh: "text-purple bg-purple/15 border-purple/30",
};

const sourceNames: Record<string, string> = {
  splunk: "Splunk Security Content",
  elastic: "Elastic Detection Rules",
  "mitre-car": "MITRE CAR",
  sentinel: "Microsoft Sentinel",
  "defender-xdr": "Microsoft Defender XDR",
  "google-secops": "Google SecOps Chronicle",
  panther: "Panther Analysis",
  falco: "Falco",
  wazuh: "Wazuh Ruleset",
};

const UNIFIED_SOURCES = new Set(["mitre-car", "sentinel", "defender-xdr", "google-secops", "panther", "falco", "wazuh"]);

// Generic unified rule detail from /api/community/unified/[slug]/rules/[id]
interface UnifiedRuleDetail {
  id: string;
  source: { id: string; name: string; type: string; url: string };
  upstreamRuleId: string;
  title: string;
  description: string;
  author: string;
  upstreamCreatedAt: string | null;
  upstreamModifiedAt: string | null;
  severity: string;
  status: string;
  ruleLanguage: string;
  ruleType: string;
  detectionLogicRaw: string;
  conversionSupported: boolean;
  mitreTechniques: string[];
  mitreTactics: string[];
  platforms: string[];
  products: string[];
  logSources: string[];
  tags: string[];
  references: string[];
  falsePositives: string[];
  sourceFilePath: string;
  sourceUrl: string;
  rawPayload: Record<string, unknown>;
  changeStatus: string;
  createdAt: string;
  updatedAt: string;
}

const changeBadge: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  new: { label: "New", color: "text-success bg-success/10 border-success/30", icon: Sparkles },
  modified: { label: "Modified", color: "text-warning bg-warning/10 border-warning/30", icon: Pencil },
  deleted: { label: "Deleted Upstream", color: "text-danger bg-danger/10 border-danger/30", icon: Trash2 },
  unchanged: { label: "Unchanged", color: "text-muted bg-muted/10 border-border", icon: Check },
};

const typeColors: Record<string, string> = {
  query: "text-accent bg-accent/10 border-accent/30",
  eql: "text-purple bg-purple/10 border-purple/30",
  threshold: "text-warning bg-warning/10 border-warning/30",
  machine_learning: "text-info bg-info/10 border-info/30",
};

const splunkTypeColors: Record<string, string> = {
  TTP: "text-danger bg-danger/10 border-danger/30",
  Anomaly: "text-warning bg-warning/10 border-warning/30",
  Hunting: "text-accent bg-accent/10 border-accent/30",
  Correlation: "text-success bg-success/10 border-success/30",
};

const splunkStatusColors: Record<string, string> = {
  production: "text-success bg-success/10 border-success/30",
  experimental: "text-warning bg-warning/10 border-warning/30",
  deprecated: "text-muted bg-muted/10 border-border",
};

// -- Elastic rule detail from API
interface ElasticRuleDetail {
  id: string;
  ruleId: string | null;
  name: string;
  description: string;
  severity: string;
  riskScore: number;
  type: string;
  language: string;
  query: string;
  index: string[];
  tags: string[];
  threat: unknown[];
  mitreTechniques: string[];
  mitreTactics: string[];
  author: string[];
  references: string[];
  falsepositives: string[];
  note: string;
  setup: string;
  ruleContent: string;
  filePath: string;
  repositoryUrl: string;
  platform: string;
  maturity: string;
  integration: string[];
  createdDate: string;
  updatedDate: string;
  changeStatus: string;
  importStatus: string;
  createdAt: string;
  updatedAt: string;
}

// -- Splunk rule detail from API
interface SplunkRuleDetail {
  id: string;
  detectionId: string;
  name: string;
  description: string;
  author: string;
  date: string;
  status: string;
  type: string;
  search: string;
  dataSource: string[];
  howToImplement: string;
  knownFalsePositives: string;
  references: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  analyticStories: string[];
  securityDomain: string;
  assetType: string;
  products: string[];
  category: string;
  filePath: string;
  sourceUrl: string;
  contentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export default function CommunityRuleDetailPage() {
  const params = useParams();
  const source = params.source as string;
  const id = params.id as string;
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"detection" | "metadata">("detection");

  // Elastic: fetch from API
  const [elasticRule, setElasticRule] = useState<ElasticRuleDetail | null>(null);
  // Splunk: fetch from API
  const [splunkRule, setSplunkRule] = useState<SplunkRuleDetail | null>(null);
  // Unified sources: fetch from API
  const [unifiedRule, setUnifiedRule] = useState<UnifiedRuleDetail | null>(null);

  const isUnified = UNIFIED_SOURCES.has(source);
  const [loading, setLoading] = useState(source === "elastic" || source === "splunk" || isUnified);
  const [notFoundState, setNotFoundState] = useState(false);

  useEffect(() => {
    if (source === "elastic") {
      (async () => {
        try {
          const res = await fetch(`/api/community/elastic/rules/${id}`);
          if (res.ok) setElasticRule(await res.json());
          else setNotFoundState(true);
        } catch { setNotFoundState(true); }
        finally { setLoading(false); }
      })();
    } else if (source === "splunk") {
      (async () => {
        try {
          const res = await fetch(`/api/community/splunk/rules/${id}`);
          if (res.ok) setSplunkRule(await res.json());
          else setNotFoundState(true);
        } catch { setNotFoundState(true); }
        finally { setLoading(false); }
      })();
    } else if (UNIFIED_SOURCES.has(source)) {
      (async () => {
        try {
          const res = await fetch(`/api/community/unified/${source}/rules/${id}`);
          if (res.ok) setUnifiedRule(await res.json());
          else setNotFoundState(true);
        } catch { setNotFoundState(true); }
        finally { setLoading(false); }
      })();
    }
  }, [source, id]);

  // Only handle known sources — sigmahq has its own route
  if (source === "sigmahq") notFound();
  if (!["splunk", "elastic", ...UNIFIED_SOURCES].includes(source)) notFound();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 animate-fade-in">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  // ── Elastic rule (from API) ──────────────────────────────────────
  if (source === "elastic") {
    if (!elasticRule || notFoundState) {
      return (
        <div className="text-center py-32 animate-fade-in">
          <Zap className="h-12 w-12 text-muted mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-foreground">Rule not found</h2>
          <Link href="/community/elastic" className="text-sm text-accent hover:underline mt-2 inline-block">Back to Elastic rules</Link>
        </div>
      );
    }

    const change = changeBadge[elasticRule.changeStatus] || changeBadge.unchanged;
    const ChangeIcon = change.icon;
    const langLabel = elasticRule.language === "eql" ? "EQL" : elasticRule.language === "kuery" ? "KQL" : elasticRule.language?.toUpperCase() || elasticRule.type.toUpperCase();

    const handleCopyElastic = () => {
      navigator.clipboard.writeText(elasticRule.query || elasticRule.ruleContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div className="space-y-6 animate-fade-in">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <Link href="/community" className="text-muted hover:text-accent transition-colors">Community</Link>
          <span className="text-muted">/</span>
          <Link href="/community/elastic" className="text-muted hover:text-accent transition-colors">Elastic Detection Rules</Link>
          <span className="text-muted">/</span>
          <span className="text-foreground font-medium truncate max-w-[300px]">{elasticRule.name}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{elasticRule.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{elasticRule.description}</p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", sourceColors.elastic)}>
                Elastic Detection Rules
              </span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", levelColors[elasticRule.severity] || "text-muted border-border")}>
                {elasticRule.severity}
              </span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", typeColors[elasticRule.type] || "text-muted border-border")}>
                {elasticRule.type}
              </span>
              <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", change.color)}>
                <ChangeIcon className="h-2.5 w-2.5" /> {change.label}
              </span>
              {elasticRule.ruleId && (
                <span className="rounded bg-card-hover px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{elasticRule.ruleId}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <a href={`/api/community/elastic/rules/${elasticRule.id}/download`}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
              <Download className="h-4 w-4" /> Download TOML
            </a>
            <a href={elasticRule.repositoryUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
              <ExternalLink className="h-4 w-4" /> View on GitHub
            </a>
            <GenerateFromRuleButton
              sourceTable="CommunityElasticRule"
              ruleId={elasticRule.id}
              ruleTitle={elasticRule.name}
            />
            <GenerateDetectionPackButton
              sourceType="rule"
              sourceTable="CommunityElasticRule"
              ruleId={elasticRule.id}
            />
            <button className="flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-medium text-white hover:bg-warning/90 transition-colors">
              <Download className="h-4 w-4" /> Import to Org
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Main content */}
          <div className="col-span-8 space-y-6">
            <div className="flex gap-1 border-b border-border">
              {(["detection", "metadata"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize", tab === t ? "text-warning border-warning" : "text-muted border-transparent hover:text-foreground")}>
                  {t === "detection" ? `Detection Query (${langLabel})` : "Metadata"}
                </button>
              ))}
            </div>

            {tab === "detection" && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-warning" />
                    <span className="text-xs font-medium text-muted-foreground">{elasticRule.filePath.split("/").pop()}</span>
                    <span className="text-[10px] text-muted">{langLabel}</span>
                  </div>
                  <button onClick={handleCopyElastic} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-card-hover transition-colors">
                    {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="overflow-auto max-h-[600px]">
                  <pre className="p-4 text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre">
                    {elasticRule.query || "(No query — this rule uses " + elasticRule.type + " type)"}
                  </pre>
                </div>
              </div>
            )}

            {tab === "metadata" && (
              <div className="space-y-4">
                {elasticRule.note && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-warning" /> Investigation Guide
                    </h3>
                    <div className="prose prose-xs text-xs text-muted-foreground max-h-[300px] overflow-auto whitespace-pre-wrap">
                      {elasticRule.note}
                    </div>
                  </div>
                )}
                {elasticRule.setup && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Zap className="h-4 w-4 text-accent" /> Setup Instructions
                    </h3>
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-auto">
                      {elasticRule.setup}
                    </div>
                  </div>
                )}
                {elasticRule.falsepositives.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning" /> False Positives
                    </h3>
                    <ul className="space-y-1">
                      {elasticRule.falsepositives.map((fp, i) => (
                        <li key={i} className="text-xs text-muted-foreground">• {fp}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {elasticRule.references.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-accent" /> References
                    </h3>
                    <ul className="space-y-1">
                      {elasticRule.references.map((ref, i) => (
                        <li key={i}>
                          <a href={ref} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline break-all">{ref}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {elasticRule.index.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">Index Patterns</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {elasticRule.index.map((idx) => (
                        <span key={idx} className="rounded bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{idx}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="col-span-4 space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted uppercase">Details</h3>
              {[
                { icon: User, label: "Author", value: elasticRule.author.join(", ") || "Unknown" },
                { icon: Calendar, label: "Created", value: elasticRule.createdDate || "—" },
                { icon: Clock, label: "Updated", value: elasticRule.updatedDate || "—" },
                { icon: Shield, label: "Risk Score", value: String(elasticRule.riskScore) },
                { icon: FileCode2, label: "Platform", value: elasticRule.platform },
                { icon: Zap, label: "Maturity", value: elasticRule.maturity || "—" },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-2">
                  <item.icon className="h-3.5 w-3.5 text-muted mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted">{item.label}</p>
                    <p className="text-xs text-foreground capitalize">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
            {elasticRule.mitreTactics.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">MITRE ATT&CK Tactics</h3>
                <div className="flex flex-wrap gap-1.5">
                  {elasticRule.mitreTactics.map((t) => (
                    <span key={t} className="rounded bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {elasticRule.mitreTechniques.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">MITRE ATT&CK Techniques</h3>
                <div className="flex flex-wrap gap-1.5">
                  {elasticRule.mitreTechniques.map((t) => (
                    <span key={t} className="rounded bg-accent/10 px-2 py-0.5 text-xs font-mono font-bold text-accent">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {elasticRule.tags.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {elasticRule.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                      <Tag className="h-2.5 w-2.5" /> {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {elasticRule.integration.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Required Integrations</h3>
                <div className="flex flex-wrap gap-1.5">
                  {elasticRule.integration.map((i) => (
                    <span key={i} className="rounded bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{i}</span>
                  ))}
                </div>
              </div>
            )}
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
                <span className="text-muted-foreground capitalize">{elasticRule.importStatus.replace("_", " ")}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted">Local updated</span>
                <span className="text-muted-foreground">{new Date(elasticRule.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Unified rule (Phase 2-4 sources) ─────────────────────────────
  if (isUnified) {
    if (!unifiedRule || notFoundState) {
      return (
        <div className="text-center py-32 animate-fade-in">
          <Shield className="h-12 w-12 text-muted mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-foreground">Rule not found</h2>
          <Link href="/community" className="text-sm text-accent hover:underline mt-2 inline-block">Back to Community Content</Link>
        </div>
      );
    }

    const srcName = unifiedRule.source.name || sourceNames[source] || source;
    const srcColor = sourceColors[source] || "text-accent bg-accent/15 border-accent/30";
    const sevColor = levelColors[unifiedRule.severity] || "text-muted bg-muted/10 border-border";
    const change = changeBadge[unifiedRule.changeStatus] || changeBadge.unchanged;
    const ChangeIcon = change.icon;

    const handleCopyUnified = () => {
      navigator.clipboard.writeText(unifiedRule.detectionLogicRaw || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const langLabel = (unifiedRule.ruleLanguage || "").toUpperCase() || "DETECTION";

    return (
      <div className="space-y-6 animate-fade-in">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <Link href="/community" className="text-muted hover:text-accent transition-colors">Community</Link>
          <span className="text-muted">/</span>
          <span className={cn("font-medium", srcColor.split(" ")[0])}>{srcName}</span>
          <span className="text-muted">/</span>
          <span className="text-foreground font-medium truncate max-w-[300px]">{unifiedRule.title}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{unifiedRule.title}</h1>
            {unifiedRule.description && (
              <p className="mt-1 text-sm text-muted-foreground">{unifiedRule.description}</p>
            )}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", srcColor)}>
                {srcName}
              </span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", sevColor)}>
                {unifiedRule.severity || "info"}
              </span>
              {unifiedRule.ruleType && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">
                  {unifiedRule.ruleType}
                </span>
              )}
              <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", change.color)}>
                <ChangeIcon className="h-2.5 w-2.5" /> {change.label}
              </span>
              {unifiedRule.upstreamRuleId && (
                <span className="rounded bg-card-hover px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{unifiedRule.upstreamRuleId}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {unifiedRule.sourceUrl && (
              <a href={unifiedRule.sourceUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
                <ExternalLink className="h-4 w-4" /> View on GitHub
              </a>
            )}
            <GenerateFromRuleButton
              sourceTable="CommunityRule"
              ruleId={unifiedRule.id}
              ruleTitle={unifiedRule.title}
            />
            <GenerateDetectionPackButton
              sourceType="rule"
              sourceTable="CommunityRule"
              ruleId={unifiedRule.id}
            />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Main content */}
          <div className="col-span-8 space-y-6">
            <div className="flex gap-1 border-b border-border">
              {(["detection", "metadata"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize", tab === t ? `${srcColor.split(" ")[0]} border-current` : "text-muted border-transparent hover:text-foreground")}>
                  {t === "detection" ? `Detection Logic (${langLabel})` : "Metadata"}
                </button>
              ))}
            </div>

            {tab === "detection" && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <div className="flex items-center gap-2">
                    <FileCode2 className={cn("h-4 w-4", srcColor.split(" ")[0])} />
                    <span className="text-xs font-medium text-muted-foreground">{unifiedRule.sourceFilePath?.split("/").pop() || "rule"}</span>
                    <span className="text-[10px] text-muted">{langLabel}</span>
                  </div>
                  <button onClick={handleCopyUnified} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-card-hover transition-colors">
                    {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="overflow-auto max-h-[600px]">
                  <pre className="p-4 text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre">
                    {unifiedRule.detectionLogicRaw || "(No detection logic available)"}
                  </pre>
                </div>
              </div>
            )}

            {tab === "metadata" && (
              <div className="space-y-4">
                {unifiedRule.falsePositives.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning" /> False Positives
                    </h3>
                    <ul className="space-y-1">
                      {unifiedRule.falsePositives.map((fp, i) => (
                        <li key={i} className="text-xs text-muted-foreground">• {fp}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {unifiedRule.references.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-accent" /> References
                    </h3>
                    <ul className="space-y-1">
                      {unifiedRule.references.map((ref, i) => (
                        <li key={i}>
                          <a href={ref} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline break-all">{ref}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {unifiedRule.logSources.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">Log Sources</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {unifiedRule.logSources.map((ls, i) => (
                        <span key={i} className="rounded bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{ls}</span>
                      ))}
                    </div>
                  </div>
                )}

                {unifiedRule.products.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-2">Products</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {unifiedRule.products.map((p) => (
                        <span key={p} className="rounded bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{p}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="col-span-4 space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted uppercase">Details</h3>
              {[
                { icon: User, label: "Author", value: unifiedRule.author || "Unknown" },
                { icon: Calendar, label: "Created Upstream", value: unifiedRule.upstreamCreatedAt ? new Date(unifiedRule.upstreamCreatedAt).toLocaleDateString() : "—" },
                { icon: Clock, label: "Modified Upstream", value: unifiedRule.upstreamModifiedAt ? new Date(unifiedRule.upstreamModifiedAt).toLocaleDateString() : "—" },
                { icon: Shield, label: "Status", value: unifiedRule.status || "—" },
                { icon: FileCode2, label: "Language", value: unifiedRule.ruleLanguage || "—" },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-2">
                  <item.icon className="h-3.5 w-3.5 text-muted mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted">{item.label}</p>
                    <p className="text-xs text-foreground capitalize">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Platforms */}
            {unifiedRule.platforms.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Platforms</h3>
                <div className="flex flex-wrap gap-1.5">
                  {unifiedRule.platforms.map((p) => (
                    <span key={p} className="rounded bg-background border border-border px-2 py-0.5 text-xs text-muted-foreground">{p}</span>
                  ))}
                </div>
              </div>
            )}

            {/* MITRE Tactics */}
            {unifiedRule.mitreTactics.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">MITRE ATT&CK Tactics</h3>
                <div className="flex flex-wrap gap-1.5">
                  {unifiedRule.mitreTactics.map((t) => (
                    <span key={t} className="rounded bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* MITRE Techniques */}
            {unifiedRule.mitreTechniques.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">MITRE ATT&CK Techniques</h3>
                <div className="flex flex-wrap gap-1.5">
                  {unifiedRule.mitreTechniques.map((t) => (
                    <span key={t} className="rounded bg-accent/10 px-2 py-0.5 text-xs font-mono font-bold text-accent">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {unifiedRule.tags.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {unifiedRule.tags.map((tag) => (
                    <span key={tag} className="flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                      <Tag className="h-2.5 w-2.5" /> {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Source Info */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-muted uppercase">Source</h3>
              <div className="flex justify-between text-xs">
                <span className="text-muted">Repository</span>
                <span className={cn("font-medium", srcColor.split(" ")[0])}>{srcName}</span>
              </div>
              {unifiedRule.sourceFilePath && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">File</span>
                  <span className="text-muted-foreground text-[10px] truncate max-w-[180px]">{unifiedRule.sourceFilePath}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-muted">Change status</span>
                <span className={cn("flex items-center gap-1 font-medium", change.color.split(" ")[0])}>
                  <ChangeIcon className="h-3 w-3" /> {change.label}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted">Local updated</span>
                <span className="text-muted-foreground">{new Date(unifiedRule.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Splunk rule (from API) ───────────────────────────────────────
  if (!splunkRule || notFoundState) {
    return (
      <div className="text-center py-32 animate-fade-in">
        <Flame className="h-12 w-12 text-muted mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-foreground">Detection not found</h2>
        <Link href="/community/splunk" className="text-sm text-accent hover:underline mt-2 inline-block">Back to Splunk detections</Link>
      </div>
    );
  }

  const handleCopySplunk = () => {
    navigator.clipboard.writeText(splunkRule.search);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/community" className="text-muted hover:text-accent transition-colors">Community</Link>
        <span className="text-muted">/</span>
        <Link href="/community/splunk" className="text-muted hover:text-purple transition-colors">Splunk Security Content</Link>
        <span className="text-muted">/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">{splunkRule.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{splunkRule.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{splunkRule.description}</p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", sourceColors.splunk)}>
              Splunk Security Content
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", splunkTypeColors[splunkRule.type] || "text-muted border-border")}>
              {splunkRule.type}
            </span>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", splunkStatusColors[splunkRule.status] || "text-muted border-border")}>
              {splunkRule.status}
            </span>
            {splunkRule.version > 0 && (
              <span className="rounded bg-card-hover px-2 py-0.5 text-[10px] font-mono text-muted-foreground">v{splunkRule.version}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {splunkRule.sourceUrl && (
            <a href={splunkRule.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
              <ExternalLink className="h-4 w-4" /> View on GitHub
            </a>
          )}
          <GenerateFromRuleButton
            sourceTable="SplunkDetection"
            ruleId={splunkRule.id}
            ruleTitle={splunkRule.name}
          />
          <GenerateDetectionPackButton
            sourceType="rule"
            sourceTable="SplunkDetection"
            ruleId={splunkRule.id}
          />
          <button className="flex items-center gap-2 rounded-lg bg-purple px-4 py-2 text-sm font-medium text-white hover:bg-purple/90 transition-colors">
            <Download className="h-4 w-4" /> Import to Org
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main content */}
        <div className="col-span-8 space-y-6">
          <div className="flex gap-1 border-b border-border">
            {(["detection", "metadata"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize", tab === t ? "text-purple border-purple" : "text-muted border-transparent hover:text-foreground")}>
                {t === "detection" ? "SPL Search Query" : "Metadata"}
              </button>
            ))}
          </div>

          {tab === "detection" && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-4 w-4 text-purple" />
                  <span className="text-xs font-medium text-muted-foreground">{splunkRule.filePath.split("/").pop()}</span>
                  <span className="text-[10px] text-muted">SPL</span>
                </div>
                <button onClick={handleCopySplunk} className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-card-hover transition-colors">
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="overflow-auto max-h-[600px]">
                <pre className="p-4 text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre">
                  {splunkRule.search || "(No search query available)"}
                </pre>
              </div>
            </div>
          )}

          {tab === "metadata" && (
            <div className="space-y-4">
              {/* How to Implement */}
              {splunkRule.howToImplement && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-purple" /> How to Implement
                  </h3>
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap max-h-[300px] overflow-auto leading-relaxed">
                    {splunkRule.howToImplement}
                  </div>
                </div>
              )}

              {/* Known False Positives */}
              {splunkRule.knownFalsePositives && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" /> Known False Positives
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{splunkRule.knownFalsePositives}</p>
                </div>
              )}

              {/* Data Sources */}
              {splunkRule.dataSource.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2">Data Sources</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {splunkRule.dataSource.map((ds, i) => (
                      <span key={i} className="rounded bg-background px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{ds}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* References */}
              {splunkRule.references.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-accent" /> References
                  </h3>
                  <ul className="space-y-1">
                    {splunkRule.references.map((ref, i) => (
                      <li key={i}>
                        <a href={ref} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline break-all">{ref}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Analytic Stories */}
              {splunkRule.analyticStories.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2">Analytic Stories</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {splunkRule.analyticStories.map((s) => (
                      <span key={s} className="rounded bg-purple/10 border border-purple/20 px-2 py-0.5 text-[10px] text-purple">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Products */}
              {splunkRule.products.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2">Products</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {splunkRule.products.map((p) => (
                      <span key={p} className="rounded bg-background px-2 py-0.5 text-[10px] text-muted-foreground">{p}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="col-span-4 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted uppercase">Details</h3>
            {[
              { icon: User, label: "Author", value: splunkRule.author || "Unknown" },
              { icon: Calendar, label: "Date", value: splunkRule.date || "—" },
              { icon: Shield, label: "Security Domain", value: splunkRule.securityDomain || "—" },
              { icon: FileCode2, label: "Category", value: splunkRule.category || "—" },
              { icon: Zap, label: "Asset Type", value: splunkRule.assetType || "—" },
              { icon: Clock, label: "Version", value: splunkRule.version ? `v${splunkRule.version}` : "—" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <item.icon className="h-3.5 w-3.5 text-muted mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] text-muted">{item.label}</p>
                  <p className="text-xs text-foreground capitalize">{item.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* MITRE Tactics */}
          {splunkRule.mitreTactics.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted uppercase mb-2">MITRE ATT&CK Tactics</h3>
              <div className="flex flex-wrap gap-1.5">
                {splunkRule.mitreTactics.map((t) => (
                  <span key={t} className="rounded bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* MITRE Techniques */}
          {splunkRule.mitreTechniques.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted uppercase mb-2">MITRE ATT&CK Techniques</h3>
              <div className="flex flex-wrap gap-1.5">
                {splunkRule.mitreTechniques.map((t) => (
                  <span key={t} className="rounded bg-accent/10 px-2 py-0.5 text-xs font-mono font-bold text-accent">{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Source Info */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h3 className="text-xs font-semibold text-muted uppercase">Source</h3>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Repository</span>
              <span className="font-medium text-purple">Splunk Security Content</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">File</span>
              <span className="text-muted-foreground text-[10px] truncate max-w-[180px]">{splunkRule.filePath}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Detection ID</span>
              <span className="text-muted-foreground font-mono text-[10px]">{splunkRule.detectionId.slice(0, 8)}…</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Local updated</span>
              <span className="text-muted-foreground">{new Date(splunkRule.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
