"use client";

import { useEffect, useRef, useState } from "react";
import {
  Swords, Plus, Loader2, RefreshCw, Inbox, ArrowLeft, AlertTriangle, CheckCircle2,
  XCircle, Clock, ChevronRight, ChevronLeft, ChevronDown, X, Play, Trash2, ShieldAlert, Square,
  Cpu, Search, Zap, ShieldCheck, Radar, Target, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FleetLite { id: string; name: string; nodeCount: number; onlineCount: number }
interface NodeLite { id: string; hostname: string; name: string; os: string; arch: string; liveness: string; status: string }
interface Progress { total: number; byStatus: Record<string, number>; done: number }
interface CampaignRow { id: string; status: string; opsExpected: number; testSelection: any[]; targetNodeIds: string[]; progress: Progress; createdBy: string; createdAt: string }

const STATUS_COLOR: Record<string, string> = {
  running: "text-info", completed: "text-success", failed: "text-danger",
  halted: "text-warning", created: "text-muted-foreground", populating: "text-info",
};

export default function CampaignsPage() {
  const [fleets, setFleets] = useState<FleetLite[]>([]);
  const [fleetId, setFleetId] = useState<string>("");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "new" | string>("list");

  useEffect(() => {
    fetch("/api/fleets").then((r) => r.json()).then((d) => {
      setFleets(d.items || []);
      if (d.items?.[0]) setFleetId((cur) => cur || d.items[0].id);
      setLoading(false);
    });
  }, []);

  const loadCampaigns = async (fid: string) => {
    if (!fid) return;
    const r = await fetch(`/api/fleets/${fid}/campaigns`);
    const d = await r.json();
    setCampaigns(d.items || []);
  };
  useEffect(() => { if (fleetId) loadCampaigns(fleetId); }, [fleetId]);

  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  if (fleets.length === 0) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Swords className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No fleets yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">Create a fleet and enroll a node in the <span className="font-medium">Fleet</span> tab first, then design a simulation here.</p>
        </div>
      </div>
    );
  }

  if (view === "new") {
    return <SimulationWizard fleetId={fleetId} onClose={() => { setView("list"); loadCampaigns(fleetId); }} />;
  }
  if (view !== "list") {
    return <CampaignDetail fleetId={fleetId} campaignId={view} onBack={() => { setView("list"); loadCampaigns(fleetId); }} />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Swords className="h-6 w-6 text-accent" /> Simulation &amp; Detection
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Design a step-by-step simulation across your live endpoints, then validate whether your SIEM caught it — in real time.</p>
        </div>
        <div className="inline-flex items-center gap-2">
          <select value={fleetId} onChange={(e) => setFleetId(e.target.value)} className="h-9 px-2 text-xs rounded-md border border-border bg-input text-foreground">
            {fleets.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.onlineCount}/{f.nodeCount} online)</option>)}
          </select>
          <button onClick={() => loadCampaigns(fleetId)} className="h-9 px-2 rounded-md border border-border text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /></button>
          <button onClick={() => setView("new")} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]">
            <Plus className="h-3.5 w-3.5" /> New simulation
          </button>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No simulations yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">Click <span className="font-mono">New simulation</span> to run tests across this fleet and score detection.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => {
            const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
            return (
              <button key={c.id} onClick={() => setView(c.id)} className="w-full text-left rounded-xl border border-border bg-card hover:bg-card-hover px-4 py-3 flex items-center gap-3">
                <Swords className="h-5 w-5 text-accent flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground truncate">{c.testSelection.map((t) => t.testName || `${t.technique} #${t.testIndex}`).slice(0, 3).join(", ")}</span>
                    <span className={cn("text-[10px] uppercase font-bold", STATUS_COLOR[c.status] || "text-muted-foreground")}>{c.status}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted/20 overflow-hidden max-w-xs">
                      <div className={cn("h-full rounded-full", c.status === "completed" ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{c.progress.done}/{c.progress.total} ops</span>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Wizard ──────────────────────────────────────────────────────────────────
type Test = { key: string; label: string; useSmoke?: boolean; technique?: string; testIndex?: number; tactic?: string; platforms?: string[]; executor?: string };
type TestRef = { testNumber: number; testName: string; platforms: string[]; executor: string; elevation: boolean };
type SubNode = { id: string; name: string; tests: TestRef[] };
type TechNode = { id: string; name: string; subs: SubNode[] };
type TacticNode = { tactic: string; techniqueCount: number; testCount: number; techniques: TechNode[] };

const TACTIC_LABEL = (t: string) => t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const STEPS = [
  { n: 1, label: "Targets", Icon: Cpu },
  { n: 2, label: "Techniques", Icon: Target },
  { n: 3, label: "Detection", Icon: Radar },
  { n: 4, label: "Launch", Icon: Play },
];

function StepRail({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-1">
          <div className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            step === s.n ? "border-accent/50 bg-accent/10 text-accent"
            : step > s.n ? "border-success/40 bg-success/10 text-success"
            : "border-border text-muted-foreground")}>
            {step > s.n ? <CheckCircle2 className="h-3.5 w-3.5" /> : <s.Icon className="h-3.5 w-3.5" />}
            {s.label}
          </div>
          {i < STEPS.length - 1 && <div className={cn("h-px w-6", step > s.n ? "bg-success" : "bg-border")} />}
        </div>
      ))}
    </div>
  );
}

function SimulationWizard({ fleetId, onClose }: { fleetId: string; onClose: () => void }) {
  const [step, setStep] = useState(1);
  // step 1
  const [nodes, setNodes] = useState<NodeLite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // step 2 — guided ATT&CK drill-down (tactic → technique → sub-technique → test)
  const [tests, setTests] = useState<Test[]>([{ key: "smoke", label: "Safe connectivity test (benign)", useSmoke: true, technique: "T0000" }]);
  const [tree, setTree] = useState<TacticNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [tactic, setTactic] = useState<string>("");
  const [openTech, setOpenTech] = useState<string>("");
  const [openSub, setOpenSub] = useState<string>("");
  const [filter, setFilter] = useState("");
  // step 3
  const [mode, setMode] = useState<"sim" | "detect">("sim");
  const [siem, setSiem] = useState<{ name: string; connected: boolean } | null>(null);
  // step 4 / launch
  const [confirm, setConfirm] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/fleets/${fleetId}`).then((r) => r.json()).then((d) => {
      const ns: NodeLite[] = (d.nodes || []).filter((n: any) => n.status !== "revoked");
      setNodes(ns);
      setSelected(new Set(ns.filter((n) => n.liveness === "online").map((n) => n.id)));
    });
    fetch("/api/integrations").then((r) => r.json()).then((d) => {
      const items = Array.isArray(d) ? d : (d.items || d.integrations || []);
      const s = items.find((i: any) => i.type === "siem");
      if (s) setSiem({ name: s.name, connected: !!s.connected });
    }).catch(() => {});
  }, [fleetId]);

  // Load the ATT&CK technique tree once for the guided picker.
  useEffect(() => {
    fetch("/api/atomic-tests/tree").then((r) => r.json()).then((d) => {
      setTree(d.tactics || []);
      setTactic((d.tactics || [])[0]?.tactic || "");
    }).finally(() => setTreeLoading(false));
  }, []);

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
      setCampaignId(d.campaignId);   // → live results phase
    } finally { setLaunching(false); }
  };

  // Once launched, show the live run + detection scoreboard.
  if (campaignId) {
    return <LiveRun fleetId={fleetId} campaignId={campaignId} mode={mode} techniques={uniqueTechniques} onClose={onClose} />;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onClose} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Simulations</button>
        <StepRail step={step} />
      </div>

      {/* STEP 1 — TARGETS */}
      {step === 1 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div><h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Cpu className="h-4 w-4 text-accent" /> Select target endpoints</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Online endpoints will run the tests. Offline ones are listed but queued until they reconnect.</p></div>
          {nodes.length === 0 ? <p className="text-xs text-muted-foreground py-4">No endpoints in this fleet — enroll one in the Fleet tab.</p> : (
            <div className="grid sm:grid-cols-2 gap-2">
              {nodes.map((n) => {
                const on = selected.has(n.id);
                return (
                  <button key={n.id} onClick={() => toggleNode(n.id)} className={cn("text-left rounded-lg border px-3 py-2.5 flex items-center gap-2.5 transition-colors",
                    on ? "border-accent/50 bg-accent/10" : "border-border bg-card hover:bg-card-hover")}>
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", n.liveness === "online" ? "bg-success animate-pulse" : n.liveness === "stale" ? "bg-warning" : "bg-muted")} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">{n.hostname || n.name || n.id.slice(0, 8)}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{n.os} {n.arch} · {n.liveness}</div>
                    </div>
                    {on && <CheckCircle2 className="h-4 w-4 text-accent flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-end pt-1">
            <button disabled={selected.size === 0} onClick={() => setStep(2)} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-accent text-white disabled:opacity-50">
              Next: Techniques <ChevronRight className="h-3.5 w-3.5" /> <span className="opacity-80">({selected.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — GUIDED TECHNIQUE DRILL-DOWN (tactic → technique → sub-technique → test) */}
      {step === 2 && (() => {
        const activeTactic = tree.find((t) => t.tactic === tactic);
        const techniques = (activeTactic?.techniques || []).filter((tn) => {
          if (!filter.trim()) return true;
          const q = filter.toLowerCase();
          return tn.id.toLowerCase().includes(q) || tn.name.toLowerCase().includes(q)
            || tn.subs.some((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
        });
        return (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div><h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Target className="h-4 w-4 text-accent" /> Choose what to simulate</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Pick a tactic, drill into a technique and its sub-techniques, then add the atomic tests to run. The benign connectivity test is always included.</p></div>

          {treeLoading ? <div className="py-6 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading ATT&amp;CK catalogue…</div> : (
          <>
            {/* Tactic chips */}
            <div className="flex flex-wrap gap-1.5">
              {tree.map((t) => (
                <button key={t.tactic} onClick={() => { setTactic(t.tactic); setOpenTech(""); setOpenSub(""); }}
                  className={cn("px-2.5 py-1 text-[11px] rounded-md border transition-colors",
                    tactic === t.tactic ? "border-accent/50 bg-accent/15 text-accent" : "border-border text-muted-foreground hover:text-foreground")}>
                  {TACTIC_LABEL(t.tactic)} <span className="opacity-60">{t.techniqueCount}</span>
                </button>
              ))}
            </div>

            {/* Filter within tactic */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter techniques in ${TACTIC_LABEL(tactic || "")}…`}
                className="w-full pl-8 pr-3 py-2 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </div>

            {/* Technique → sub-technique → test accordion */}
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
                          const isParent = s.id === tn.id;
                          const subOpen = openSub === s.id;
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
                                          className={cn("inline-flex items-center gap-0.5 text-[10px] h-6 px-2 rounded border",
                                            added ? "border-success/40 bg-success/10 text-success" : "border-accent/40 text-accent hover:bg-accent/10")}>
                                          {added ? <><CheckCircle2 className="h-3 w-3" /> added</> : <><Plus className="h-3 w-3" /> add</>}
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
          </>
          )}

          {/* Selected tray */}
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
            <button onClick={() => setStep(1)} className="inline-flex items-center gap-1 h-9 px-4 text-xs rounded-md border border-border text-muted-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
            <button onClick={() => setStep(3)} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-accent text-white">Next: Detection <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        );
      })()}

      {/* STEP 3 — MODE / DETECTION */}
      {step === 3 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div><h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Radar className="h-4 w-4 text-accent" /> Simulation mode</h3></div>
          <div className="grid sm:grid-cols-2 gap-2">
            <button onClick={() => setMode("sim")} className={cn("text-left rounded-lg border p-3.5 transition-colors", mode === "sim" ? "border-accent/50 bg-accent/10" : "border-border hover:bg-card-hover")}>
              <div className="flex items-center gap-2 text-foreground"><Zap className={cn("h-4 w-4", mode === "sim" ? "text-accent" : "text-muted-foreground")} /><span className="text-xs font-semibold">Simulation only</span></div>
              <p className="text-[11px] text-muted-foreground mt-1">Run the tests on the endpoints and capture execution results. No SIEM lookup.</p>
            </button>
            <button onClick={() => setMode("detect")} className={cn("text-left rounded-lg border p-3.5 transition-colors", mode === "detect" ? "border-purple/50 bg-purple/10" : "border-border hover:bg-card-hover")}>
              <div className="flex items-center gap-2 text-foreground"><ShieldCheck className={cn("h-4 w-4", mode === "detect" ? "text-purple" : "text-muted-foreground")} /><span className="text-xs font-semibold">Simulation &amp; Detection</span></div>
              <p className="text-[11px] text-muted-foreground mt-1">After execution, query your SIEM to score whether each technique was detected — in real time.</p>
            </button>
          </div>

          {mode === "detect" && (
            <div className={cn("rounded-lg border px-3 py-2.5 text-[11px] flex items-center gap-2",
              siem?.connected ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning")}>
              {siem?.connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {siem ? (siem.connected
                ? <>SIEM connected: <span className="font-medium">{siem.name}</span> — community Splunk detections for the selected techniques will be queried.</>
                : <><span className="font-medium">{siem.name}</span> is configured but not connected. Connect it under Integrations, or run in Simulation-only mode.</>)
                : <>No SIEM integration found. Add Splunk under Integrations to enable detection scoring.</>}
            </div>
          )}

          <div className="flex justify-between pt-1">
            <button onClick={() => setStep(2)} className="inline-flex items-center gap-1 h-9 px-4 text-xs rounded-md border border-border text-muted-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
            <button onClick={() => setStep(4)} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-accent text-white">Next: Review <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {/* STEP 4 — REVIEW & LAUNCH */}
      {step === 4 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div><h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Play className="h-4 w-4 text-accent" /> Review &amp; launch</h3></div>
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-background/40 p-3"><div className="text-xl font-bold text-foreground">{selected.size}</div><div className="text-[10px] text-muted-foreground uppercase">endpoints</div></div>
            <div className="rounded-lg border border-border bg-background/40 p-3"><div className="text-xl font-bold text-foreground">{tests.length}</div><div className="text-[10px] text-muted-foreground uppercase">tests</div></div>
            <div className="rounded-lg border border-border bg-background/40 p-3"><div className="text-xl font-bold text-foreground">{opsExpected}</div><div className="text-[10px] text-muted-foreground uppercase">operations</div></div>
          </div>
          <div className="text-[11px] text-muted-foreground space-y-1">
            <div>Mode: {mode === "detect" ? <span className="text-purple font-medium">Simulation &amp; Detection (SIEM scoring)</span> : <span className="text-accent font-medium">Simulation only</span>}</div>
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
            <button onClick={() => setStep(3)} className="inline-flex items-center gap-1 h-9 px-4 text-xs rounded-md border border-border text-muted-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>
            <button disabled={launching || (hasAtomic && !confirm)} onClick={launch} className="inline-flex items-center gap-1.5 h-9 px-5 text-xs font-bold rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
              {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Launch simulation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Live run + detection scoreboard ────────────────────────────────────────
const OP_ICON: Record<string, { Icon: any; color: string }> = {
  success: { Icon: CheckCircle2, color: "text-success" }, failed: { Icon: XCircle, color: "text-danger" },
  blocked: { Icon: ShieldAlert, color: "text-warning" }, cleanup_failed: { Icon: AlertTriangle, color: "text-danger" },
  running: { Icon: Loader2, color: "text-info" }, queued: { Icon: Clock, color: "text-muted-foreground" },
  cancelled: { Icon: Square, color: "text-muted-foreground" },
};

function LiveRun({ fleetId, campaignId, mode, techniques, onClose }: { fleetId: string; campaignId: string; mode: "sim" | "detect"; techniques: string[]; onClose: () => void }) {
  const [c, setC] = useState<any>(null);
  const [detect, setDetect] = useState<any>(null);
  const [detecting, setDetecting] = useState(false);
  const ranDetect = useRef(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    const r = await fetch(`/api/fleets/${fleetId}/campaigns/${campaignId}`);
    if (r.ok) setC(await r.json());
  };
  useEffect(() => { load(); poll.current = setInterval(load, 2000); return () => { if (poll.current) clearInterval(poll.current); }; // eslint-disable-next-line
  }, [fleetId, campaignId]);

  const done = c && c.progress.done === c.progress.total && c.progress.total > 0;

  // When simulation finishes + detection mode + we have real techniques, run SIEM validation once.
  useEffect(() => {
    if (!done || mode !== "detect" || ranDetect.current || techniques.length === 0) return;
    ranDetect.current = true;
    setDetecting(true);
    fetch(`/api/fleets/${fleetId}/detect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ techniques, minutes: 30 }) })
      .then((r) => r.json()).then(setDetect).finally(() => setDetecting(false));
  }, [done, mode, techniques, fleetId]);

  if (!c) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Starting…</div>;
  const pct = c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onClose} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Done</button>
        <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
          {done ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Activity className="h-3.5 w-3.5 text-info animate-pulse" />}
          {done ? "simulation complete" : "running…"}
        </div>
      </div>

      {/* Execution progress */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Zap className="h-4 w-4 text-accent" /> Execution</h3>
          <span className="text-[11px] text-muted-foreground">{c.progress.done}/{c.progress.total} ops · {Object.entries(c.progress.byStatus).map(([k, v]) => `${v} ${k}`).join(" · ")}</span>
        </div>
        <div className="h-2 rounded-full bg-muted/20 overflow-hidden"><div className={cn("h-full rounded-full transition-all", done ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} /></div>
        <div className="divide-y divide-border max-h-64 overflow-y-auto">
          {c.operations.map((o: any) => {
            const oi = OP_ICON[o.status] || OP_ICON.queued;
            return (
              <div key={o.id} className="py-1.5 flex items-center gap-2 text-[11px]">
                <oi.Icon className={cn("h-3.5 w-3.5", oi.color, o.status === "running" && "animate-spin")} />
                <span className="text-foreground font-medium">{o.nodeName}</span>
                <span className="font-mono text-accent">{o.technique} #{o.testIndex}</span>
                <span className={cn("uppercase font-bold text-[9px]", oi.color)}>{o.status}</span>
                {o.result && <span className="text-[10px] text-muted-foreground ml-auto">cleanup: <span className={o.result.cleanupStatus === "ok" ? "text-success" : "text-danger"}>{o.result.cleanupStatus}</span> · exit={o.result.exitCode ?? "?"}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detection scoreboard */}
      {mode === "detect" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-purple" /> Detection scoreboard {!done && <span className="text-[10px] text-muted-foreground font-normal">(waiting for execution to finish…)</span>}</h3>
          {detecting && <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> querying SIEM for {techniques.length} technique(s)…</div>}
          {detect?.error && <div className="text-[11px] text-warning inline-flex items-center gap-1.5"><AlertTriangle className="h-3 w-3" /> {detect.error}</div>}
          {detect?.results && (
            <div className="space-y-1.5">
              <div className="text-[10px] text-muted-foreground">SIEM: {detect.siem?.name || "—"} · window {detect.windowMinutes || 30}m</div>
              {detect.results.map((res: any) => {
                const det = res.detected;
                return (
                  <div key={res.technique} className="rounded-md border border-border bg-background/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      {res.siemUnavailable ? <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                        : det ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-danger" />}
                      <span className="font-mono text-accent">{res.technique}</span>
                      <span className={cn("uppercase font-bold text-[9px]", res.siemUnavailable ? "text-muted-foreground" : det ? "text-success" : "text-danger")}>
                        {res.siemUnavailable ? "no SIEM" : det ? "detected" : "missed"}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{res.detectionCount ?? 0} matching rule(s)</span>
                    </div>
                    {res.detections?.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {res.detections.map((d: any, i: number) => (
                          <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1.5 pl-5">
                            <span className={d.fired ? "text-success" : "text-muted-foreground"}>{d.fired ? "●" : "○"}</span>
                            <span className="truncate">{d.name}</span>
                            {d.error ? <span className="text-warning ml-auto">{d.error}</span> : <span className="ml-auto">{d.eventCount} event(s)</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CampaignDetail({ fleetId, campaignId, onBack }: { fleetId: string; campaignId: string; onBack: () => void }) {
  // Re-use the live view for history (it polls; detection re-run is gated behind mode which history lacks → sim view).
  return <LiveRun fleetId={fleetId} campaignId={campaignId} mode="sim" techniques={[]} onClose={onBack} />;
}
