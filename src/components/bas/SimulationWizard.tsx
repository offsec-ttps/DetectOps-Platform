"use client";

/**
 * Fleet Simulation & Detection wizard — Campaign-Designer-style 4-step flow,
 * driven by the BAS fleet's live endpoints as "servers":
 *   1. Select Server(s)   — live fleet nodes
 *   2. Select Techniques  — guided ATT&CK drill-down (tactic→technique→sub→test)
 *   3. Configure          — Simulation only vs Simulation & Detection (SIEM)
 *   4. Launch & Results    — live execution + real-time detection scoreboard
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Server, Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock, ChevronRight,
  ChevronLeft, ChevronDown, Play, Trash2, ShieldAlert, ShieldCheck, Square, Search, Zap,
  Radar, Target, Activity, PowerOff, Cpu, Download, Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NodeLite { id: string; hostname: string; name: string; os: string; osVersion?: string; arch: string; liveness: string; status: string; agentVersion?: string }
type Test = { key: string; label: string; useSmoke?: boolean; technique?: string; testIndex?: number; tactic?: string; platforms?: string[]; executor?: string };
type TestRef = { testNumber: number; testName: string; platforms: string[]; executor: string; elevation: boolean };
type SubNode = { id: string; name: string; tests: TestRef[] };
type TechNode = { id: string; name: string; subs: SubNode[] };
type TacticNode = { tactic: string; techniqueCount: number; testCount: number; techniques: TechNode[] };
const TACTIC_LABEL = (t: string) => t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const WSTEPS = [
  { n: 1, label: "Select Server" },
  { n: 2, label: "Select Techniques" },
  { n: 3, label: "Configure" },
  { n: 4, label: "Launch & Results" },
];

function StepRail({ step, setStep }: { step: number; setStep: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0 flex-wrap">
      {WSTEPS.map((s, i) => (
        <React.Fragment key={s.n}>
          <button onClick={() => step > s.n && setStep(s.n)} className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
            step === s.n ? "bg-accent/10 text-accent border border-accent/30" : step > s.n ? "text-success" : "text-muted-foreground")}>
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
              step === s.n ? "bg-accent text-white" : step > s.n ? "bg-success text-white" : "bg-muted/20 text-muted")}>
              {step > s.n ? <CheckCircle2 className="h-3 w-3" /> : s.n}
            </span>
            {s.label}
          </button>
          {i < WSTEPS.length - 1 && <div className={cn("h-px w-8 mx-1", step > s.n ? "bg-success" : "bg-border")} />}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function SimulationWizard({ fleetId, onDone }: { fleetId: string; onDone?: () => void }) {
  const [step, setStep] = useState(1);
  const [nodes, setNodes] = useState<NodeLite[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [tests, setTests] = useState<Test[]>([{ key: "smoke", label: "Safe connectivity test (benign)", useSmoke: true, technique: "T0000" }]);
  const [tree, setTree] = useState<TacticNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [tactic, setTactic] = useState("");
  const [openTech, setOpenTech] = useState("");
  const [openSub, setOpenSub] = useState("");
  const [filter, setFilter] = useState("");

  const [mode, setMode] = useState<"sim" | "detect">("sim");
  const [siem, setSiem] = useState<{ name: string; connected: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const loadNodes = () => {
    setNodesLoading(true);
    fetch(`/api/fleets/${fleetId}`).then((r) => r.json()).then((d) => {
      const ns: NodeLite[] = (d.nodes || []).filter((n: any) => n.status !== "revoked");
      setNodes(ns);
      setSelected((cur) => cur.size ? cur : new Set(ns.filter((n) => n.liveness === "online").map((n) => n.id)));
    }).finally(() => setNodesLoading(false));
  };
  useEffect(() => {
    loadNodes();
    fetch("/api/integrations").then((r) => r.json()).then((d) => {
      const items = Array.isArray(d) ? d : (d.items || d.integrations || []);
      const s = items.find((i: any) => i.type === "siem");
      if (s) setSiem({ name: s.name, connected: !!s.connected });
    }).catch(() => {});
    fetch("/api/atomic-tests/tree").then((r) => r.json()).then((d) => {
      setTree(d.tactics || []); setTactic((d.tactics || [])[0]?.tactic || "");
    }).finally(() => setTreeLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetId]);

  const toggleNode = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addTestRef = (subId: string, tacticName: string, ref: TestRef) => {
    const key = `${subId}-${ref.testNumber}`;
    if (tests.some((t) => t.key === key)) return;
    setTests((t) => [...t, { key, label: `${subId} · ${ref.testName}`, technique: subId, testIndex: ref.testNumber, tactic: tacticName, platforms: ref.platforms, executor: ref.executor }]);
  };
  const removeTest = (key: string) => setTests((t) => t.filter((x) => x.key !== key));
  const isAdded = (subId: string, n: number) => tests.some((t) => t.key === `${subId}-${n}`);

  const hasAtomic = tests.some((t) => !t.useSmoke);
  const opsExpected = selected.size * tests.length;
  const uniqueTechniques = [...new Set(tests.filter((t) => !t.useSmoke).map((t) => t.technique!))];

  const launch = async () => {
    setLaunching(true); setError(null);
    try {
      const r = await fetch(`/api/fleets/${fleetId}/campaigns`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testSelection: tests.map((t) => t.useSmoke ? { useSmoke: true } : { technique: t.technique, testIndex: t.testIndex }),
          targetNodeIds: [...selected],
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "launch failed"); return; }
      setCampaignId(d.campaignId);
    } finally { setLaunching(false); }
  };

  if (campaignId) {
    return <LiveRun fleetId={fleetId} campaignId={campaignId} mode={mode} techniques={uniqueTechniques}
      onClose={() => { setCampaignId(null); setStep(1); onDone?.(); }} />;
  }

  const onlineCount = nodes.filter((n) => n.liveness === "online").length;

  return (
    <div className="space-y-5">
      <StepRail step={step} setStep={setStep} />

      {/* STEP 1 — SELECT SERVER (live fleet nodes) */}
      {step === 1 && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Step 1: Select Simulation Server</h3>
              <p className="text-xs text-muted-foreground mt-1">Choose the live endpoint(s) to run on. Techniques execute locally on the agent; offline hosts queue until they reconnect.</p>
            </div>
            <button onClick={loadNodes} disabled={nodesLoading} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover disabled:opacity-50">
              <RefreshCw className={cn("h-3 w-3", nodesLoading && "animate-spin")} /> Refresh
            </button>
          </div>

          {nodes.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <PowerOff className="h-10 w-10 text-warning mb-3" />
              <p className="text-sm font-medium text-foreground">No endpoints enrolled</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">Enroll an endpoint in the <span className="font-medium">Servers</span> tab — run the install command on the target host and it appears here the moment it heartbeats.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Cpu className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-semibold text-foreground">Fleet endpoints</span>
                <span className="text-[11px] text-muted-foreground">({onlineCount} online / {nodes.length})</span>
              </div>
              {nodes.map((t) => {
                const isSel = selected.has(t.id);
                const online = t.liveness === "online";
                const offline = t.liveness === "offline";
                return (
                  <button key={t.id} onClick={() => !offline && toggleNode(t.id)} disabled={offline}
                    className={cn("w-full flex items-center justify-between rounded-lg border p-4 transition-all text-left",
                      isSel ? "border-accent/40 bg-accent/5" : "border-border hover:bg-card-hover", offline && "opacity-50 cursor-not-allowed")}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0", isSel ? "bg-accent/10" : "bg-muted/10")}>
                        <Server className={cn("h-5 w-5", isSel ? "text-accent" : "text-muted")} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">{t.hostname || t.name || t.id.slice(0, 8)}</p>
                          {t.agentVersion && <code className="text-[10px] font-mono text-muted-foreground bg-background rounded px-1">v{t.agentVersion}</code>}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                          <span className="font-mono">{t.os} {t.arch}</span><span>·</span>
                          <span className={cn(online ? "text-success" : t.liveness === "stale" ? "text-warning" : "text-muted-foreground")}>● {t.liveness}</span>
                          {online && <span className="rounded bg-success/10 px-1 py-0.5 text-success font-medium">live agent</span>}
                        </div>
                      </div>
                    </div>
                    {isSel && <CheckCircle2 className="h-5 w-5 text-accent flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button disabled={selected.size === 0} onClick={() => setStep(2)} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-lg bg-accent text-white disabled:opacity-50">
              Next: Techniques <ChevronRight className="h-3.5 w-3.5" /> <span className="opacity-80">({selected.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — GUIDED TECHNIQUE DRILL-DOWN */}
      {step === 2 && (() => {
        const activeTactic = tree.find((t) => t.tactic === tactic);
        const techniques = (activeTactic?.techniques || []).filter((tn) => {
          if (!filter.trim()) return true;
          const q = filter.toLowerCase();
          return tn.id.toLowerCase().includes(q) || tn.name.toLowerCase().includes(q) || tn.subs.some((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
        });
        return (
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div><h3 className="text-sm font-semibold text-foreground">Step 2: Select Techniques</h3>
              <p className="text-xs text-muted-foreground mt-1">Pick a tactic, drill into a technique and its sub-techniques, then add the atomic tests to run. A benign connectivity test is always included.</p></div>
            {treeLoading ? <div className="py-6 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading ATT&amp;CK catalogue…</div> : (<>
              <div className="flex flex-wrap gap-1.5">
                {tree.map((t) => (
                  <button key={t.tactic} onClick={() => { setTactic(t.tactic); setOpenTech(""); setOpenSub(""); }}
                    className={cn("px-2.5 py-1 text-[11px] rounded-md border transition-colors", tactic === t.tactic ? "border-accent/50 bg-accent/15 text-accent" : "border-border text-muted-foreground hover:text-foreground")}>
                    {TACTIC_LABEL(t.tactic)} <span className="opacity-60">{t.techniqueCount}</span>
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter techniques in ${TACTIC_LABEL(tactic || "")}…`}
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              </div>
              <div className="rounded-md border border-border divide-y divide-border max-h-80 overflow-y-auto">
                {techniques.length === 0 && <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No techniques match.</div>}
                {techniques.map((tn) => {
                  const techOpen = openTech === tn.id;
                  return (
                    <div key={tn.id}>
                      <button onClick={() => { setOpenTech(techOpen ? "" : tn.id); setOpenSub(""); }} className="w-full text-left px-3 py-2 hover:bg-card-hover flex items-center gap-2">
                        {techOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                        <span className="font-mono text-[11px] text-accent">{tn.id}</span>
                        <span className="text-[11px] text-foreground truncate flex-1">{tn.name}</span>
                        <span className="text-[10px] text-muted-foreground">{tn.subs.length} sub · {tn.subs.reduce((n, s) => n + s.tests.length, 0)} tests</span>
                      </button>
                      {techOpen && (
                        <div className="bg-background/30 border-t border-border">
                          {tn.subs.map((s) => {
                            const isParent = s.id === tn.id; const subOpen = openSub === s.id;
                            return (
                              <div key={s.id}>
                                <button onClick={() => setOpenSub(subOpen ? "" : s.id)} className="w-full text-left pl-8 pr-3 py-1.5 hover:bg-card-hover flex items-center gap-2">
                                  {subOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                                  <span className="font-mono text-[10px] text-info">{s.id}</span>
                                  <span className="text-[10px] text-muted-foreground truncate flex-1">{isParent ? "(technique-level tests)" : s.name}</span>
                                  <span className="text-[9px] text-muted-foreground">{s.tests.length}</span>
                                </button>
                                {subOpen && (
                                  <div className="pl-12 pr-3 pb-1.5 space-y-1">
                                    {s.tests.map((tr) => {
                                      const added = isAdded(s.id, tr.testNumber);
                                      return (
                                        <div key={tr.testNumber} className="flex items-center gap-2 py-1">
                                          <span className="text-[10px] text-foreground truncate flex-1">#{tr.testNumber} {tr.testName}
                                            <span className="text-muted-foreground"> · {tr.platforms.join("/")} · {tr.executor}{tr.elevation ? " · ⚠" : ""}</span></span>
                                          <button onClick={() => added ? removeTest(`${s.id}-${tr.testNumber}`) : addTestRef(s.id, tactic, tr)}
                                            className={cn("inline-flex items-center gap-0.5 text-[10px] h-6 px-2 rounded border", added ? "border-success/40 bg-success/10 text-success" : "border-accent/40 text-accent hover:bg-accent/10")}>
                                            {added ? <><CheckCircle2 className="h-3 w-3" /> added</> : <><Play className="h-3 w-3" /> add</>}
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>)}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Selected ({tests.length})</div>
              {tests.map((t) => (
                <div key={t.key} className="flex items-center gap-2 px-3 py-2 rounded-md bg-background/40 border border-border">
                  {t.useSmoke ? <ShieldCheck className="h-3.5 w-3.5 text-success flex-shrink-0" /> : <Zap className="h-3.5 w-3.5 text-warning flex-shrink-0" />}
                  <span className="text-[11px] text-foreground truncate flex-1">{t.label}</span>
                  {!t.useSmoke && <span className="text-[9px] text-warning uppercase font-bold">real ART</span>}
                  {!t.useSmoke && <button onClick={() => removeTest(t.key)} className="text-muted-foreground hover:text-danger"><Trash2 className="h-3 w-3" /></button>}
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-1">
              <button onClick={() => setStep(1)} className="inline-flex items-center gap-1 h-9 px-4 text-xs rounded-lg border border-border text-muted-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
              <button onClick={() => setStep(3)} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-lg bg-accent text-white">Next: Configure <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        );
      })()}

      {/* STEP 3 — CONFIGURE (mode) */}
      {step === 3 && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div><h3 className="text-sm font-semibold text-foreground">Step 3: Configure Parameters</h3>
            <p className="text-xs text-muted-foreground mt-1">Run the techniques only, or run them and validate detection against your SIEM in real time.</p></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <button onClick={() => setMode("sim")} className={cn("text-left rounded-lg border p-4 transition-colors", mode === "sim" ? "border-accent/50 bg-accent/10" : "border-border hover:bg-card-hover")}>
              <div className="flex items-center gap-2 text-foreground"><Zap className={cn("h-4 w-4", mode === "sim" ? "text-accent" : "text-muted-foreground")} /><span className="text-sm font-semibold">Just Simulation</span></div>
              <p className="text-[11px] text-muted-foreground mt-1">Execute on the endpoints and capture results. No SIEM lookup.</p>
            </button>
            <button onClick={() => setMode("detect")} className={cn("text-left rounded-lg border p-4 transition-colors", mode === "detect" ? "border-purple/50 bg-purple/10" : "border-border hover:bg-card-hover")}>
              <div className="flex items-center gap-2 text-foreground"><ShieldCheck className={cn("h-4 w-4", mode === "detect" ? "text-purple" : "text-muted-foreground")} /><span className="text-sm font-semibold">Simulation &amp; Detection</span></div>
              <p className="text-[11px] text-muted-foreground mt-1">After execution, query the SIEM to score detected / missed per technique.</p>
            </button>
          </div>
          {mode === "detect" && (
            <div className={cn("rounded-lg border px-3 py-2.5 text-[11px] flex items-center gap-2", siem?.connected ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning")}>
              {siem?.connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {siem ? (siem.connected ? <>SIEM connected: <span className="font-medium">{siem.name}</span> — Splunk detections for the selected techniques will be queried.</>
                : <><span className="font-medium">{siem.name}</span> is configured but not connected. Connect it under Integrations, or use Just Simulation.</>)
                : <>No SIEM integration found. Add Splunk under Integrations to enable detection scoring.</>}
            </div>
          )}
          <div className="flex justify-between pt-1">
            <button onClick={() => setStep(2)} className="inline-flex items-center gap-1 h-9 px-4 text-xs rounded-lg border border-border text-muted-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
            <button onClick={() => setStep(4)} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-lg bg-accent text-white">Next: Launch <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {/* STEP 4 — LAUNCH */}
      {step === 4 && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div><h3 className="text-sm font-semibold text-foreground">Step 4: Launch &amp; Results</h3></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-background/40 p-3"><div className="text-xl font-bold text-foreground">{selected.size}</div><div className="text-[10px] text-muted-foreground uppercase">endpoints</div></div>
            <div className="rounded-lg border border-border bg-background/40 p-3"><div className="text-xl font-bold text-foreground">{tests.length}</div><div className="text-[10px] text-muted-foreground uppercase">tests</div></div>
            <div className="rounded-lg border border-border bg-background/40 p-3"><div className="text-xl font-bold text-foreground">{opsExpected}</div><div className="text-[10px] text-muted-foreground uppercase">operations</div></div>
          </div>
          <div className="text-[11px] text-muted-foreground space-y-1">
            <div>Mode: {mode === "detect" ? <span className="text-purple font-medium">Simulation &amp; Detection</span> : <span className="text-accent font-medium">Just Simulation</span>}</div>
            <div>Cleanup: <span className="text-success">enforced</span> · Jobs: <span className="text-foreground">ed25519-signed</span></div>
          </div>
          {hasAtomic && (
            <label className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 accent-danger" />
              <span className="text-[11px] text-danger">This will execute real adversary techniques on {selected.size} live endpoint(s). I confirm authorization.</span>
            </label>
          )}
          {error && <div className="text-[11px] text-danger inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {error}</div>}
          <div className="flex justify-between pt-1">
            <button onClick={() => setStep(3)} className="inline-flex items-center gap-1 h-9 px-4 text-xs rounded-lg border border-border text-muted-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
            <button disabled={launching || (hasAtomic && !confirm)} onClick={launch} className="inline-flex items-center gap-1.5 h-9 px-5 text-xs font-bold rounded-lg bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
              {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Launch simulation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const OP_ICON: Record<string, { Icon: any; color: string }> = {
  success: { Icon: CheckCircle2, color: "text-success" }, failed: { Icon: XCircle, color: "text-danger" },
  blocked: { Icon: ShieldAlert, color: "text-warning" }, cleanup_failed: { Icon: AlertTriangle, color: "text-danger" },
  running: { Icon: Loader2, color: "text-info" }, queued: { Icon: Clock, color: "text-muted-foreground" },
  cancelled: { Icon: Square, color: "text-muted-foreground" },
};

// ── Per-technique log viewer ──
function LogBlock({ label, text, tone }: { label: string; text?: string; tone?: "out" | "err" }) {
  const body = (text || "").trim();
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        <Terminal className="h-3 w-3" /> {label}
      </div>
      {body
        ? <pre className={cn("text-[10px] font-mono whitespace-pre-wrap break-all rounded-md border border-border bg-black/40 p-2 max-h-48 overflow-y-auto", tone === "err" ? "text-danger/90" : "text-foreground/90")}>{body}</pre>
        : <div className="text-[10px] text-muted-foreground italic rounded-md border border-dashed border-border p-2">(empty)</div>}
    </div>
  );
}

function RunDetail({ o }: { o: any }) {
  const r = o.result;
  return (
    <div className="ml-5 mb-2 mt-1 rounded-lg border border-border bg-background/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span>node <span className="text-foreground font-medium">{o.nodeName}</span></span>
        <span>technique <span className="font-mono text-accent">{o.technique} #{o.testIndex}</span></span>
        <span>execute <span className={cn("font-bold uppercase", r.executeStatus === "success" ? "text-success" : r.executeStatus === "blocked" ? "text-warning" : "text-danger")}>{r.executeStatus}</span></span>
        <span>cleanup <span className={cn("font-bold uppercase", r.cleanupStatus === "ok" ? "text-success" : "text-danger")}>{r.cleanupStatus}</span></span>
        <span>exit <span className="text-foreground font-mono">{r.exitCode ?? "?"}</span></span>
        {r.durationMs ? <span>{(r.durationMs / 1000).toFixed(1)}s</span> : null}
        {r.endedAt ? <span>{new Date(r.endedAt).toLocaleString()}</span> : null}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-foreground flex items-center gap-1.5"><Zap className="h-3 w-3 text-accent" /> Simulation output</div>
          <LogBlock label="stdout" text={r.stdout} tone="out" />
          <LogBlock label="stderr" text={r.stderr} tone="err" />
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-foreground flex items-center gap-1.5"><Trash2 className="h-3 w-3 text-purple" /> Cleanup output</div>
          <LogBlock label="stdout" text={r.cleanupStdout} tone="out" />
          <LogBlock label="stderr" text={r.cleanupStderr} tone="err" />
        </div>
      </div>
      {(r.bundleHash || o.bundleHash) && <div className="text-[9px] text-muted-foreground font-mono">bundle {(r.bundleHash || o.bundleHash).slice(0, 24)}…</div>}
    </div>
  );
}

// Build a human-readable Markdown report from the loaded campaign + detection.
function downloadRunReport(c: any, detect: any) {
  if (!c) return;
  const L: string[] = [];
  L.push(`# Fleet Simulation Report`);
  L.push(``, `- Campaign: \`${c.id}\``, `- Status: ${c.status}`, `- Created: ${c.createdAt} by ${c.createdBy || "—"}`, `- Progress: ${c.progress?.done}/${c.progress?.total} ops`);
  L.push(``, `## Executions`, ``);
  for (const o of c.operations || []) {
    const r = o.result;
    L.push(`### ${o.technique} #${o.testIndex} — ${o.nodeName}`);
    L.push(`- Operation status: **${o.status}**`);
    if (r) {
      L.push(`- Execute: **${r.executeStatus}** · Cleanup: **${r.cleanupStatus}** · Exit: ${r.exitCode ?? "?"}${r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}`);
      L.push(``, `**Simulation stdout**`, "```", (r.stdout || "(empty)").trim(), "```");
      if ((r.stderr || "").trim()) L.push(`**Simulation stderr**`, "```", r.stderr.trim(), "```");
      L.push(`**Cleanup stdout**`, "```", (r.cleanupStdout || "(empty)").trim(), "```");
      if ((r.cleanupStderr || "").trim()) L.push(`**Cleanup stderr**`, "```", r.cleanupStderr.trim(), "```");
    } else {
      L.push(`- (no result reported yet)`);
    }
    L.push(``);
  }
  if (detect?.results?.length) {
    L.push(`## Detection`, ``, `SIEM: ${detect.siem?.name || "—"} · window ${detect.windowMinutes || 30}m`, ``);
    for (const res of detect.results) L.push(`- ${res.technique}: **${res.siemUnavailable ? "no SIEM" : res.detected ? "DETECTED" : "MISSED"}** (${res.detectionCount ?? 0} rule(s))`);
  }
  const blob = new Blob([L.join("\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fleet-report-${c.id.slice(0, 8)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function LiveRun({ fleetId, campaignId, mode, techniques, onClose }: { fleetId: string; campaignId: string; mode: "sim" | "detect"; techniques: string[]; onClose: () => void }) {
  const [c, setC] = useState<any>(null);
  const [detect, setDetect] = useState<any>(null);
  const [detecting, setDetecting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const ranDetect = useRef(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => { const r = await fetch(`/api/fleets/${fleetId}/campaigns/${campaignId}`); if (r.ok) setC(await r.json()); };
  useEffect(() => { load(); poll.current = setInterval(load, 2000); return () => { if (poll.current) clearInterval(poll.current); }; // eslint-disable-next-line
  }, [fleetId, campaignId]);
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const done = c && c.progress.done === c.progress.total && c.progress.total > 0;
  useEffect(() => {
    if (!done || mode !== "detect" || ranDetect.current || techniques.length === 0) return;
    ranDetect.current = true; setDetecting(true);
    fetch(`/api/fleets/${fleetId}/detect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ techniques, minutes: 30 }) })
      .then((r) => r.json()).then(setDetect).finally(() => setDetecting(false));
  }, [done, mode, techniques, fleetId]);

  if (!c) return <div className="p-2 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Starting…</div>;
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onClose} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
        <div className="flex items-center gap-3">
          <button onClick={() => downloadRunReport(c, detect)} className="inline-flex items-center gap-1.5 text-[11px] rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground hover:bg-card-hover">
            <Download className="h-3 w-3" /> Download report
          </button>
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            {done ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Activity className="h-3.5 w-3.5 text-info animate-pulse" />}
            {done ? "simulation complete" : "running…"}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Zap className="h-4 w-4 text-accent" /> Execution</h3>
          <span className="text-[11px] text-muted-foreground">{c.progress.done}/{c.progress.total} ops · {Object.entries(c.progress.byStatus).map(([k, v]) => `${v} ${k}`).join(" · ")}</span>
        </div>
        <div className="h-2 rounded-full bg-muted/20 overflow-hidden"><div className={cn("h-full rounded-full transition-all", done ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} /></div>
        <p className="text-[10px] text-muted-foreground">Click a technique to view its execution &amp; cleanup output.</p>
        <div className="divide-y divide-border max-h-[28rem] overflow-y-auto">
          {c.operations.map((o: any) => {
            const oi = OP_ICON[o.status] || OP_ICON.queued;
            const hasLogs = !!o.result;
            const open = expanded.has(o.id);
            return (
              <div key={o.id}>
                <button onClick={() => hasLogs && toggle(o.id)} disabled={!hasLogs}
                  className={cn("w-full py-1.5 flex items-center gap-2 text-[11px] text-left", hasLogs && "hover:bg-card-hover rounded px-1 -mx-1", !hasLogs && "cursor-default")}>
                  {hasLogs ? <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-90")} /> : <span className="w-3" />}
                  <oi.Icon className={cn("h-3.5 w-3.5", oi.color, o.status === "running" && "animate-spin")} />
                  <span className="text-foreground font-medium">{o.nodeName}</span>
                  <span className="font-mono text-accent">{o.technique} #{o.testIndex}</span>
                  <span className={cn("uppercase font-bold text-[9px]", oi.color)}>{o.status}</span>
                  {o.result && (
                    <span className="text-[10px] text-muted-foreground ml-auto inline-flex items-center gap-2">
                      <span>exec: <span className={o.result.executeStatus === "success" ? "text-success" : o.result.executeStatus === "blocked" ? "text-warning" : "text-danger"}>{o.result.executeStatus}</span></span>
                      <span>cleanup: <span className={o.result.cleanupStatus === "ok" ? "text-success" : "text-danger"}>{o.result.cleanupStatus}</span></span>
                      <span>exit={o.result.exitCode ?? "?"}</span>
                      {o.result.durationMs ? <span>{Math.round(o.result.durationMs / 1000)}s</span> : null}
                    </span>
                  )}
                </button>
                {open && o.result && <RunDetail o={o} />}
              </div>
            );
          })}
        </div>
      </div>
      {mode === "detect" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-purple" /> Detection scoreboard {!done && <span className="text-[10px] text-muted-foreground font-normal">(waiting for execution…)</span>}</h3>
          {detecting && <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> querying SIEM for {techniques.length} technique(s)…</div>}
          {detect?.error && <div className="text-[11px] text-warning inline-flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> {detect.error}</div>}
          {detect?.results && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-muted-foreground">SIEM: {detect.siem?.name || "—"} · window {detect.windowMinutes || 30}m</div>
              {detect.results.map((res: any) => (
                <div key={res.technique} className="rounded-md border border-border bg-background/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    {res.siemUnavailable ? <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" /> : res.detected ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-danger" />}
                    <span className="font-mono text-accent">{res.technique}</span>
                    <span className={cn("uppercase font-bold text-[9px]", res.siemUnavailable ? "text-muted-foreground" : res.detected ? "text-success" : "text-danger")}>{res.siemUnavailable ? "no SIEM" : res.detected ? "detected" : "missed"}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{res.detectionCount ?? 0} matching rule(s)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
