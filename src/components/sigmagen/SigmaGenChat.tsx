"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Sparkles, User, AlertCircle, Plus, FileText, Link2, Hash, ShieldCheck, ShieldAlert } from "lucide-react";
import { AgentTimeline, type PipelineStep } from "./AgentTimeline";
import { RunArtifacts, type RichUseCase, type RunRef } from "./RunArtifacts";
import { IntelPanel, type IntelData } from "./IntelPanel";
import { ChatInput, type SendPayload } from "./ChatInput";
import { SessionSidebar, type SessionSummary } from "./SessionSidebar";

interface Message { id: string; role: string; content: string; inputKind: string; attachmentName: string; runId: string | null; createdAt: string; }
interface GuardrailReport { flagged?: boolean; severity?: string; signals?: Array<{ category: string; sample: string }>; strippedChars?: number; notes?: string }
interface Run {
  id: string; status: string; inputKind: string; inputTitle: string;
  steps: PipelineStep[]; techniques: string[]; references: RunRef[];
  intel: IntelData; guardrail?: GuardrailReport; useCases: RichUseCase[];
  detectionPackId: string | null; useCaseIds: string[]; costUsd: number; errorMessage: string | null;
}

const ACTIVE = new Set(["queued", "running"]);
const KIND_ICON: Record<string, React.ElementType> = { url: Link2, pdf: FileText, docx: FileText, ioc: Hash, txt: FileText, text: Hash };

export function SigmaGenChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const runById = useCallback((id: string | null) => runs.find((r) => r.id === id), [runs]);

  const refreshSessions = useCallback(async () => {
    const res = await fetch("/api/sigmagen/sessions");
    if (res.ok) setSessions((await res.json()).sessions || []);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const res = await fetch(`/api/sigmagen/sessions/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages || []);
    setRuns(data.runs || []);
  }, []);

  const selectSession = useCallback(async (id: string) => {
    setSessionId(id); setError(null);
    await loadSession(id);
  }, [loadSession]);

  // Bootstrap: load history; resume the most recent session if any (else lazy-create on first send).
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/sigmagen/sessions");
      if (!res.ok) return;
      const list: SessionSummary[] = (await res.json()).sessions || [];
      setSessions(list);
      if (list.length) { setSessionId(list[0].id); await loadSession(list[0].id); }
    })();
  }, [loadSession]);

  // Poll while any run is active.
  useEffect(() => {
    if (!sessionId) return;
    if (!runs.some((r) => ACTIVE.has(r.status))) return;
    const t = setInterval(() => { loadSession(sessionId); refreshSessions(); }, 1600);
    return () => clearInterval(t);
  }, [sessionId, runs, loadSession, refreshSessions]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, runs]);

  const newChat = () => { setSessionId(null); setMessages([]); setRuns([]); setError(null); };

  const deleteSession = async (id: string) => {
    await fetch(`/api/sigmagen/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === sessionId) newChat();
    await refreshSessions();
  };

  const send = async (p: SendPayload) => {
    setSending(true); setError(null);
    try {
      // Lazy-create a session on first message.
      let sid = sessionId;
      if (!sid) {
        const cr = await fetch("/api/sigmagen/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!cr.ok) { setError("Could not create session"); return; }
        sid = (await cr.json()).session.id; setSessionId(sid);
      }
      if (!sid) { setError("Could not create session"); return; }
      let res: Response;
      if (p.file) {
        const fd = new FormData();
        fd.append("file", p.file);
        fd.append("enableRetrieval", String(p.enableRetrieval));
        if (p.provider) fd.append("provider", p.provider);
        res = await fetch(`/api/sigmagen/sessions/${sid}/run`, { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/sigmagen/sessions/${sid}/run`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: p.text, enableRetrieval: p.enableRetrieval, provider: p.provider }),
        });
      }
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`); return; }
      await loadSession(sid);
      await refreshSessions();
    } catch (e) {
      setError((e as Error).message || "Failed to start pipeline");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] gap-0">
      {/* Main chat column */}
      <div className="flex flex-1 flex-col min-w-0 pr-3">
        <div className="flex items-start justify-between pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><Sparkles className="h-6 w-6 text-accent" /> SigmaGen AI</h1>
            <p className="mt-1 text-sm text-muted-foreground">Drop a URL, PDF, report, or IOCs — a multi-agent pipeline extracts ATT&CK techniques, drafts use cases, maps simulations, and generates detection rules. All sessions are saved in the history panel.</p>
          </div>
          <button onClick={newChat} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors">
            <Plus className="h-3.5 w-3.5" /> New chat
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Sparkles className="h-12 w-12 text-muted mb-3" />
              <h3 className="text-lg font-semibold text-foreground">Start an analysis</h3>
              <p className="max-w-md text-sm text-muted-foreground mt-1">Paste a threat-intel blog URL (e.g. a DFIR Report post), upload a PDF/DOCX report, or paste a set of IOCs. SigmaGen does the rest — and saves it to your history.</p>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "user") {
              const Icon = KIND_ICON[m.inputKind] || Hash;
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="flex max-w-[80%] items-start gap-2.5">
                    <div className="rounded-2xl rounded-tr-sm bg-accent/10 border border-accent/20 px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-xs text-foreground"><Icon className="h-3.5 w-3.5 text-accent" /> {m.content}</div>
                    </div>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15"><User className="h-4 w-4 text-accent" /></div>
                  </div>
                </div>
              );
            }
            const run = runById(m.runId);
            return (
              <div key={m.id} className="flex justify-start">
                <div className="flex w-full max-w-[92%] items-start gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple/15"><Sparkles className="h-4 w-4 text-purple" /></div>
                  <div className="min-w-0 flex-1 space-y-3">
                    {run ? <RunCard run={run} /> : <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">{m.content}</div>}
                  </div>
                </div>
              </div>
            );
          })}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
        </div>

        <div className="pt-2">
          <ChatInput onSend={send} disabled={sending} />
        </div>
      </div>

      {/* History sidebar (right) */}
      <SessionSidebar sessions={sessions} activeId={sessionId} onSelect={selectSession} onNew={newChat} onDelete={deleteSession} />
    </div>
  );
}

function GuardrailBadge({ g }: { g: GuardrailReport }) {
  if (!g || (!g.flagged && !g.strippedChars)) {
    return <div className="flex items-center gap-1.5 text-[10px] text-success"><ShieldCheck className="h-3 w-3" /> Input sanitized · no injection detected</div>;
  }
  const sev = g.severity || "low";
  const color = sev === "high" ? "text-danger border-danger/30 bg-danger/10" : sev === "medium" ? "text-warning border-warning/30 bg-warning/10" : "text-info border-info/30 bg-info/10";
  return (
    <div className={cn("rounded-lg border px-2.5 py-1.5 text-[10px]", color)}>
      <div className="flex items-center gap-1.5 font-medium"><ShieldAlert className="h-3 w-3" /> Guardrails: {sev} risk — content isolated as untrusted data</div>
      {g.notes && <p className="mt-0.5 opacity-90">{g.notes}</p>}
      {g.signals?.length ? <p className="mt-0.5 opacity-75">Indicators: {[...new Set(g.signals.map((s) => s.category))].join(", ")}</p> : null}
    </div>
  );
}

function RunCard({ run }: { run: Run }) {
  const done = run.status === "completed";
  const failed = run.status === "failed";
  return (
    <div className="space-y-3">
      {run.guardrail && (run.guardrail.flagged || (run.guardrail.strippedChars || 0) > 0) && <GuardrailBadge g={run.guardrail} />}
      {run.intel?.summary && <IntelPanel intel={run.intel} />}
      <AgentTimeline steps={run.steps} />
      {failed && run.errorMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle className="h-4 w-4 shrink-0" /> Pipeline failed: {run.errorMessage}
        </div>
      )}
      {done && (run.detectionPackId || run.useCases.length > 0) && (
        <>
          <RunArtifacts detectionPackId={run.detectionPackId} useCases={run.useCases || []} references={run.references || []} />
          {run.costUsd > 0 && <div className="text-right text-[10px] text-muted">Pipeline cost: ${run.costUsd.toFixed(4)}</div>}
        </>
      )}
    </div>
  );
}
