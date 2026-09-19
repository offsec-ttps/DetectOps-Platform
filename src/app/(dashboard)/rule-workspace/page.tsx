"use client";

/**
 * Rule Workspace
 *
 * Sigma rule editor + Sigma CLI / pySigma converter.
 *
 * Phase 6 spike: this is the FIRST functional version. The previous page was
 * a placeholder UI with no backend. We now wire it to the new
 * /api/rule-workspace/sigma-convert endpoint, which:
 *   - detects whether Sigma CLI is installed
 *   - lists available pySigma backends
 *   - converts the YAML in the editor to the chosen target language
 *   - persists every conversion attempt to the SigmaConversion table
 */

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Code2, Play, Copy, Check, Download, FileCode2, ArrowRight, Shield,
  RefreshCw, SplitSquareVertical, Loader2, AlertTriangle, Terminal,
  ExternalLink, Sparkles, Search, Save, GitPullRequest, ListChecks,
  X, BookmarkPlus, Filter,
} from "lucide-react";

interface Candidate {
  id: string;
  sourceTable: string;
  sourceName: string;
  sourceType: string;
  upstreamRuleId: string;
  title: string;
  description: string;
  severity: string;
  ruleLanguage: string;
  sigmaConvertible: boolean;
  detectionLogic: string;
  mitreTechniques: string[];
  mitreTactics: string[];
  platforms: string[];
  tags: string[];
}

interface CandidateResponse {
  items: Candidate[];
  total: number;
  facets: {
    bySource: Record<string, number>;
    sigmaConvertible: number;
    referenceOnly: number;
  };
}

interface RuleDraft {
  id: string;
  title: string;
  notes: string;
  sourceName: string;
  sourceTable: string | null;
  sourceRuleId: string | null;
  originalLanguage: string;
  originalLogic: string;
  adaptedLanguage: string;
  adaptedLogic: string;
  conversionTarget: string | null;
  status: string;
  prNumber: number | null;
  prUrl: string | null;
  prRepo: string | null;
  createdAt: string;
  updatedAt: string;
}

const SAMPLE_SIGMA = `title: Suspicious PowerShell Encoded Command
id: 7c69b86e-a98a-49a4-9e8f-1e2eebf5a2cd
status: experimental
description: Detects PowerShell processes spawned with encoded arguments
author: detection platform
date: 2024-01-01
logsource:
  category: process_creation
  product: windows
detection:
  selection:
    Image|endswith: '\\powershell.exe'
    CommandLine|contains:
      - '-EncodedCommand'
      - '-enc '
      - '-e '
  condition: selection
falsepositives:
  - Legitimate scripts using encoded commands
level: high
tags:
  - attack.execution
  - attack.t1059.001
`;

interface ConverterInfo {
  enabled: boolean;
  sigmaCli: {
    found: boolean;
    version: string | null;
    binary: string | null;
    installHint: string | null;
    searchedPaths: string[];
  };
  backends: string[];
  backendsRaw: string | null;
}

interface ConvertResponse {
  success: boolean;
  query?: string;
  error?: string;
  installHint?: string;
  stderr?: string;
  target?: string;
  toolVersion?: string;
}

export default function RuleWorkspacePage() {
  const [yaml, setYaml] = useState(SAMPLE_SIGMA);
  const [target, setTarget] = useState("splunk");
  const [info, setInfo] = useState<ConverterInfo | null>(null);
  const [output, setOutput] = useState<ConvertResponse | null>(null);
  const [converting, setConverting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(true);

  // Phase 6: candidate selector
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateTechnique, setCandidateTechnique] = useState("");
  const [candidatePlatform, setCandidatePlatform] = useState("");
  const [sigmaOnly, setSigmaOnly] = useState(false);
  const [candidates, setCandidates] = useState<CandidateResponse | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);

  // Phase 7: drafts
  const [drafts, setDrafts] = useState<RuleDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [draftPanelOpen, setDraftPanelOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftTitle, setDraftTitle] = useState("");

  // PR dialog
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [prDraft, setPrDraft] = useState<RuleDraft | null>(null);
  const [prOwner, setPrOwner] = useState("");
  const [prRepo, setPrRepo] = useState("");
  const [prBaseBranch, setPrBaseBranch] = useState("main");
  const [prSubmitting, setPrSubmitting] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);

  const fetchInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const res = await fetch("/api/rule-workspace/sigma-convert");
      if (res.ok) setInfo(await res.json());
    } catch { /* ignore */ }
    setLoadingInfo(false);
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  // ── Phase 6 candidate fetch ──
  const fetchCandidates = useCallback(async () => {
    setLoadingCandidates(true);
    try {
      const sp = new URLSearchParams();
      if (candidateQuery) sp.set("q", candidateQuery);
      if (candidateTechnique) sp.set("technique", candidateTechnique);
      if (candidatePlatform) sp.set("platform", candidatePlatform);
      if (sigmaOnly) sp.set("sigmaOnly", "true");
      sp.set("pageSize", "40");
      const res = await fetch(`/api/rule-workspace/candidates?${sp.toString()}`);
      if (res.ok) setCandidates(await res.json());
    } finally {
      setLoadingCandidates(false);
    }
  }, [candidateQuery, candidateTechnique, candidatePlatform, sigmaOnly]);

  useEffect(() => {
    const t = setTimeout(fetchCandidates, 250); // debounce
    return () => clearTimeout(t);
  }, [fetchCandidates]);

  // ── Phase 7 drafts fetch ──
  const fetchDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const res = await fetch("/api/rule-workspace/drafts?pageSize=50");
      if (res.ok) {
        const j = await res.json();
        setDrafts(j.items);
      }
    } finally {
      setLoadingDrafts(false);
    }
  }, []);

  useEffect(() => { fetchDrafts(); }, [fetchDrafts]);

  // Loading a candidate into the editor
  const loadCandidate = (c: Candidate) => {
    setSelectedCandidate(c);
    setYaml(c.detectionLogic || "");
    setOutput(null);
    setDraftTitle(c.title);
    setDraftNotes(`Adapted from ${c.sourceName} · ${c.upstreamRuleId}`);
  };

  // Save current editor state as a new draft
  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      const body = {
        title: draftTitle || selectedCandidate?.title || "Untitled draft",
        notes: draftNotes,
        sourceTable: selectedCandidate?.sourceTable ?? null,
        sourceRuleId: selectedCandidate?.id ?? null,
        sourceName: selectedCandidate?.sourceName ?? "",
        originalLanguage: selectedCandidate?.ruleLanguage ?? "sigma",
        originalLogic: selectedCandidate?.detectionLogic ?? yaml,
        adaptedLanguage: output?.success ? target : (selectedCandidate?.ruleLanguage ?? "sigma"),
        adaptedLogic: output?.success && output.query ? output.query : yaml,
        conversionTarget: output?.success ? target : null,
        conversionToolVersion: output?.toolVersion ?? "",
      };
      const res = await fetch("/api/rule-workspace/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchDrafts();
        setDraftPanelOpen(true);
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const openPrDialog = (draft: RuleDraft) => {
    setPrDraft(draft);
    setPrError(null);
    setPrModalOpen(true);
  };

  const submitPr = async () => {
    if (!prDraft) return;
    setPrSubmitting(true);
    setPrError(null);
    try {
      const res = await fetch(`/api/rule-workspace/drafts/${prDraft.id}/create-pr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: prOwner, repo: prRepo, baseBranch: prBaseBranch }),
      });
      const j = await res.json();
      if (!res.ok) {
        setPrError(j.error || j.hint || "PR creation failed");
      } else {
        await fetchDrafts();
        setPrModalOpen(false);
      }
    } catch (e: any) {
      setPrError(e.message);
    } finally {
      setPrSubmitting(false);
    }
  };

  const handleConvert = async () => {
    setConverting(true);
    setOutput(null);
    try {
      const res = await fetch("/api/rule-workspace/sigma-convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml, target }),
      });
      const data: ConvertResponse = await res.json();
      setOutput(data);
    } catch (err: any) {
      setOutput({ success: false, error: err.message });
    }
    setConverting(false);
  };

  const handleCopy = async () => {
    if (!output?.query) return;
    await navigator.clipboard.writeText(output.query);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleLoadSample = () => setYaml(SAMPLE_SIGMA);

  const sigmaInstalled = info?.sigmaCli.found ?? false;
  const availableBackends = info?.backends ?? ["splunk", "esql", "elastic_lucene", "kql", "panther"];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rule Workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sigma rule editor with Sigma CLI / pySigma conversion to SPL, KQL, EQL, ESQL, and other backends
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDraftPanelOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
          >
            <ListChecks className="h-3 w-3" /> Drafts
            {drafts.length > 0 && (
              <span className="ml-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] text-accent">{drafts.length}</span>
            )}
          </button>
          <button onClick={fetchInfo} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button onClick={handleLoadSample} className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors">
            <Sparkles className="h-3 w-3" /> Load Sample
          </button>
        </div>
      </div>

      {/* ── Phase 6: Candidate selector ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-4 py-2 bg-card-hover flex items-center gap-2">
          <Search className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-foreground">Find a Detection</span>
          <span className="text-[10px] text-muted-foreground">
            Search across SigmaHQ, Elastic, Splunk, Sentinel, MITRE CAR, Defender XDR, Google SecOps, Panther, Falco, and Wazuh
          </span>
          {candidates && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {candidates.facets.sigmaConvertible} sigma-convertible · {candidates.facets.referenceOnly} reference-only · {candidates.total} total
            </span>
          )}
        </div>
        <div className="p-3 grid grid-cols-12 gap-2">
          <input
            type="text"
            value={candidateQuery}
            onChange={(e) => setCandidateQuery(e.target.value)}
            placeholder="Search title, description, or rule id…"
            className="col-span-5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            value={candidateTechnique}
            onChange={(e) => setCandidateTechnique(e.target.value)}
            placeholder="ATT&CK technique (T1059)"
            className="col-span-3 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            value={candidatePlatform}
            onChange={(e) => setCandidatePlatform(e.target.value)}
            placeholder="Platform (windows, linux…)"
            className="col-span-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent"
          />
          <label className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={sigmaOnly} onChange={(e) => setSigmaOnly(e.target.checked)} className="accent-accent" />
            Sigma-convertible only
          </label>
        </div>
        <div className="max-h-72 overflow-auto border-t border-border">
          {loadingCandidates && !candidates && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {candidates && candidates.items.length === 0 && !loadingCandidates && (
            <div className="text-center py-6 text-[10px] text-muted-foreground">No candidates match.</div>
          )}
          <ul className="divide-y divide-border">
            {candidates?.items.map((c) => {
              const selected = selectedCandidate?.id === c.id && selectedCandidate?.sourceTable === c.sourceTable;
              return (
                <li
                  key={`${c.sourceTable}:${c.id}`}
                  onClick={() => loadCandidate(c)}
                  className={cn(
                    "px-4 py-2 cursor-pointer transition-colors",
                    selected ? "bg-accent/10" : "hover:bg-card-hover",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase font-semibold text-muted-foreground">{c.sourceName}</span>
                    {c.sigmaConvertible ? (
                      <span className="rounded-full bg-success/15 border border-success/30 text-success text-[9px] px-1.5 py-0.5 uppercase font-semibold">
                        Sigma-native
                      </span>
                    ) : (
                      <span className="rounded-full bg-card-hover border border-border text-muted-foreground text-[9px] px-1.5 py-0.5 uppercase">
                        Reference · {c.ruleLanguage}
                      </span>
                    )}
                    <span className="text-[9px] text-muted-foreground">{c.severity}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-foreground truncate">{c.title}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.mitreTechniques.slice(0, 4).map((t) => (
                      <span key={t} className="rounded bg-accent/10 border border-accent/20 px-1 text-[9px] text-accent font-mono">{t}</span>
                    ))}
                    {c.platforms.slice(0, 3).map((p) => (
                      <span key={p} className="rounded bg-background border border-border px-1 text-[9px] text-muted-foreground">{p}</span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Selected candidate label + reference-only notice */}
      {selectedCandidate && (
        <div className={cn(
          "rounded-xl border p-3 flex items-start gap-2",
          selectedCandidate.sigmaConvertible
            ? "border-accent/30 bg-accent/5"
            : "border-warning/30 bg-warning/5",
        )}>
          <Filter className="h-4 w-4 text-accent mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-medium text-foreground">
              Editing: <span className="font-mono">{selectedCandidate.title}</span>
              <span className="ml-2 text-[10px] text-muted-foreground">{selectedCandidate.sourceName}</span>
            </p>
            {!selectedCandidate.sigmaConvertible && (
              <p className="text-[10px] text-warning mt-1">
                This rule is in <strong>{selectedCandidate.ruleLanguage}</strong>, not Sigma. Sigma CLI conversion is disabled
                — the logic is shown as reference. You can still adapt it manually and save as a draft.
              </p>
            )}
          </div>
          <button
            onClick={() => { setSelectedCandidate(null); setYaml(SAMPLE_SIGMA); setOutput(null); }}
            className="text-muted-foreground hover:text-foreground"
            title="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Sigma CLI status banner */}
      {!loadingInfo && info && (
        <div
          className={cn(
            "rounded-xl border p-3",
            sigmaInstalled
              ? "border-success/30 bg-success/5"
              : "border-warning/30 bg-warning/5",
          )}
        >
          <div className="flex items-start gap-2">
            {sigmaInstalled ? (
              <Check className="h-4 w-4 text-success mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
            )}
            <div className="flex-1">
              {sigmaInstalled ? (
                <>
                  <p className="text-xs font-medium text-success">
                    Sigma CLI ready · {info.sigmaCli.version}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                    {info.sigmaCli.binary}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {info.backends.length} backend{info.backends.length === 1 ? "" : "s"} available
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs font-medium text-warning">Sigma CLI not installed</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {info.sigmaCli.installHint}
                  </p>
                  <details className="mt-2">
                    <summary className="text-[9px] text-muted-foreground cursor-pointer hover:text-foreground">
                      Searched paths ({info.sigmaCli.searchedPaths.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {info.sigmaCli.searchedPaths.map((p) => (
                        <li key={p} className="text-[9px] font-mono text-muted-foreground">· {p}</li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Editor + output split */}
      <div className="grid grid-cols-12 gap-4">
        {/* Sigma Editor */}
        <div className="col-span-6">
          <div className="rounded-xl border border-border bg-card overflow-hidden h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-card-hover">
              <div className="flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-accent" />
                <span className="text-xs font-semibold text-foreground">Sigma Rule Editor</span>
                <span className="text-[10px] text-muted">YAML · {yaml.split("\n").length} lines</span>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(yaml)}
                className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-background transition-colors"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <textarea
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full p-4 text-[11px] font-mono leading-relaxed bg-background text-foreground border-0 focus:outline-none resize-none"
              style={{ minHeight: "420px" }}
            />
          </div>
        </div>

        {/* Converted output */}
        <div className="col-span-6">
          <div className="rounded-xl border border-border bg-card overflow-hidden h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-card-hover">
              <div className="flex items-center gap-2">
                <SplitSquareVertical className="h-4 w-4 text-purple" />
                <span className="text-xs font-semibold text-foreground">Converted Output</span>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="rounded border border-border bg-background px-2 py-0.5 text-[10px] text-foreground"
                >
                  {availableBackends.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleConvert}
                  disabled={
                    converting || !sigmaInstalled || yaml.trim().length === 0 ||
                    (selectedCandidate ? !selectedCandidate.sigmaConvertible : false)
                  }
                  className="flex items-center gap-1 rounded bg-accent/10 border border-accent/30 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-30"
                  title={
                    !sigmaInstalled ? "Sigma CLI is not installed" :
                    (selectedCandidate && !selectedCandidate.sigmaConvertible)
                      ? `Cannot convert ${selectedCandidate.ruleLanguage} via Sigma CLI`
                      : "Convert this Sigma rule"
                  }
                >
                  {converting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  {converting ? "Converting..." : "Convert"}
                </button>
                <button
                  onClick={saveDraft}
                  disabled={savingDraft || yaml.trim().length === 0}
                  className="flex items-center gap-1 rounded bg-success/10 border border-success/30 px-2 py-1 text-[10px] font-medium text-success hover:bg-success/20 disabled:opacity-30"
                  title="Save current editor state as a workspace draft"
                >
                  {savingDraft ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save as Draft
                </button>
                <button
                  onClick={handleCopy}
                  disabled={!output?.query}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-background transition-colors disabled:opacity-30"
                >
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {!output && (
                <div className="flex flex-col items-center justify-center h-full p-12 text-center" style={{ minHeight: "420px" }}>
                  <Terminal className="h-8 w-8 text-muted mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {sigmaInstalled
                      ? `Click Convert to render this rule as ${target}`
                      : "Install Sigma CLI to enable conversion"}
                  </p>
                </div>
              )}
              {output && output.success && (
                <pre className="p-4 text-[11px] font-mono text-foreground leading-relaxed whitespace-pre-wrap">
                  {output.query}
                </pre>
              )}
              {output && !output.success && (
                <div className="p-4">
                  <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
                    <p className="text-xs font-medium text-danger flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> Conversion failed
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">{output.error}</p>
                    {output.installHint && (
                      <p className="text-[10px] text-warning mt-2 font-mono">{output.installHint}</p>
                    )}
                    {output.stderr && (
                      <details className="mt-2">
                        <summary className="text-[9px] text-muted-foreground cursor-pointer">stderr</summary>
                        <pre className="mt-1 text-[9px] font-mono text-muted-foreground whitespace-pre-wrap">{output.stderr}</pre>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action bar — kept for visual continuity, will be wired in later phases */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Shield className="h-3 w-3 text-accent" />
          <span>Conversions are persisted to the audit log. Original rules are never modified.</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/SigmaHQ/sigma-cli"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-card-hover transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Sigma CLI docs
          </a>
        </div>
      </div>

      {/* ── Phase 7: Drafts side panel ── */}
      {draftPanelOpen && (
        <div className="fixed inset-y-0 right-0 z-40 w-[420px] border-l border-border bg-card shadow-xl flex flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card-hover">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-foreground">Workspace Drafts</h2>
              <span className="text-[10px] text-muted-foreground">{drafts.length} total</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={fetchDrafts} className="text-muted-foreground hover:text-foreground" title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setDraftPanelOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {loadingDrafts && drafts.length === 0 && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingDrafts && drafts.length === 0 && (
              <div className="text-center py-10 text-[10px] text-muted-foreground">
                No drafts yet. Pick a candidate and click <strong>Save as Draft</strong>.
              </div>
            )}
            <ul className="divide-y divide-border">
              {drafts.map((d) => {
                const statusColor =
                  d.status === "merged" ? "text-success bg-success/15 border-success/30" :
                  d.status === "pr_open" ? "text-accent bg-accent/15 border-accent/30" :
                  d.status === "review" ? "text-warning bg-warning/15 border-warning/30" :
                  d.status === "abandoned" ? "text-muted-foreground bg-card-hover border-border" :
                  "text-foreground bg-card-hover border-border";
                return (
                  <li key={d.id} className="px-4 py-3 hover:bg-card-hover transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] uppercase font-semibold", statusColor)}>
                            {d.status}
                          </span>
                          {d.conversionTarget && (
                            <span className="text-[9px] text-muted-foreground font-mono">→ {d.conversionTarget}</span>
                          )}
                        </div>
                        <p className="mt-1 text-xs font-medium text-foreground truncate">{d.title}</p>
                        {d.sourceName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{d.sourceName}</p>
                        )}
                        {d.notes && (
                          <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{d.notes}</p>
                        )}
                        {d.prUrl && (
                          <a
                            href={d.prUrl}
                            target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline mt-1"
                          >
                            <GitPullRequest className="h-3 w-3" />
                            #{d.prNumber} · {d.prRepo}
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <button
                        onClick={() => {
                          setYaml(d.adaptedLogic || d.originalLogic);
                          setDraftTitle(d.title);
                          setDraftNotes(d.notes);
                        }}
                        className="rounded border border-border px-2 py-0.5 text-[9px] text-muted-foreground hover:bg-background"
                      >
                        Load
                      </button>
                      {d.status !== "pr_open" && d.status !== "merged" && (
                        <button
                          onClick={() => openPrDialog(d)}
                          className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[9px] text-accent hover:bg-accent/20"
                        >
                          <GitPullRequest className="inline h-2.5 w-2.5 mr-0.5" /> Open PR
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete draft "${d.title}"?`)) return;
                          await fetch(`/api/rule-workspace/drafts/${d.id}`, { method: "DELETE" });
                          fetchDrafts();
                        }}
                        className="rounded border border-border px-2 py-0.5 text-[9px] text-muted-foreground hover:text-danger hover:border-danger/30"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* ── Phase 7: PR modal ── */}
      {prModalOpen && prDraft && (
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card-hover">
              <div className="flex items-center gap-2">
                <GitPullRequest className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-foreground">Open Pull Request</h2>
              </div>
              <button onClick={() => setPrModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <p className="text-[10px] text-muted-foreground">Draft</p>
                <p className="text-sm text-foreground">{prDraft.title}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Owner</label>
                  <input
                    type="text"
                    value={prOwner}
                    onChange={(e) => setPrOwner(e.target.value)}
                    placeholder="your-org"
                    className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Repo</label>
                  <input
                    type="text"
                    value={prRepo}
                    onChange={(e) => setPrRepo(e.target.value)}
                    placeholder="detection-rules-internal"
                    className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Base branch</label>
                <input
                  type="text"
                  value={prBaseBranch}
                  onChange={(e) => setPrBaseBranch(e.target.value)}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:border-accent"
                />
              </div>
              {prError && (
                <div className="rounded border border-danger/30 bg-danger/5 p-2 text-[10px] text-danger">
                  {prError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setPrModalOpen(false)}
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-card-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={submitPr}
                  disabled={prSubmitting || !prOwner || !prRepo}
                  className="flex items-center gap-1 rounded bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-30"
                >
                  {prSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitPullRequest className="h-3 w-3" />}
                  Create PR
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
