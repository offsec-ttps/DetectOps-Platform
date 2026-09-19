"use client";

/**
 * Built-in module view: multi-mode phishing simulation (authorized, audited).
 * Modes — A) Templates, B) Tool catalogue, C) AI generation. Campaigns require
 * approval before launch; launch runs the phishing ATT&CK techniques through the
 * existing safe runner for detection scoring. Includes consent gate + global
 * kill-switch + compliance panel.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Mail, Loader2, ShieldAlert, Play, CheckCircle2, XCircle, AlertTriangle, FileText, Boxes, Sparkles,
  Server, Trash2, Plus, ChevronLeft, ChevronRight, Ban, BadgeCheck, ScrollText, Clock, Power,
  Eye, Code2, Star, CornerUpLeft, Paperclip, Globe, Lock, Home, Phone, Landmark, Users, ArrowRight, LayoutGrid,
} from "lucide-react";
import { PHISHGRID_COVERAGE, INDUSTRY_COVERAGE, COVERAGE_SOURCE, templateMatchesIndustry } from "@/lib/phishing/coverage";
import { cn } from "@/lib/utils";

type Tab = "home" | "campaigns" | "new" | "templates" | "tools" | "compliance";
const STATUS_STYLE: Record<string, string> = {
  draft: "border-border text-muted-foreground", pending_approval: "border-warning/30 bg-warning/10 text-warning",
  approved: "border-info/30 bg-info/10 text-info", running: "border-accent/40 bg-accent/10 text-accent",
  completed: "border-success/30 bg-success/10 text-success", aborted: "border-danger/30 bg-danger/10 text-danger",
  rejected: "border-danger/30 bg-danger/10 text-danger",
};

export default function PhishingSimulationView() {
  const [tab, setTab] = useState<Tab>("home");
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [envs, setEnvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [killing, setKilling] = useState(false);
  const [preselect, setPreselect] = useState("");   // template id to preselect in the wizard
  const [industryFilter, setIndustryFilter] = useState<any>(null);   // industry → filter Templates tab

  const load = useCallback(async () => {
    const [c, ev] = await Promise.all([
      fetch("/api/phishing/campaigns").then((r) => r.json()).catch(() => ({ items: [] })),
      fetch("/api/environment-targets").then((r) => r.json()).catch(() => ({ items: [] })),
    ]);
    setCampaigns(c.items || []); setEnvs(ev.items || ev.environments || []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const killSwitch = async () => {
    if (!confirm("KILL-SWITCH: immediately abort ALL pending/approved/running phishing campaigns?")) return;
    setKilling(true);
    try { await fetch("/api/phishing/kill-switch", { method: "POST" }); await load(); } finally { setKilling(false); }
  };

  const TABS: Array<{ k: Tab; label: string; Icon: any }> = [
    { k: "home", label: "Home", Icon: Home }, { k: "templates", label: "Templates", Icon: FileText },
    { k: "new", label: "New Campaign", Icon: Plus }, { k: "campaigns", label: "Campaigns", Icon: Mail },
    { k: "tools", label: "Frameworks", Icon: Boxes }, { k: "compliance", label: "Compliance", Icon: ScrollText },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><Mail className="h-6 w-6 text-warning" /> Phishing Simulation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Authorized, audited phishing simulation — templates, frameworks, and AI generation. Every campaign is approval-gated and maps to detection scoring.</p>
        </div>
        <button onClick={killSwitch} disabled={killing} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-bold rounded-md border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-50">
          {killing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />} Kill-switch
        </button>
      </div>

      {/* consent / authorized-use banner */}
      <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning inline-flex items-start gap-2">
        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        Authorized use only. Campaigns require explicit approval, use dummy data, and are fully audited. Do not target systems without documented permission.
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => <button key={t.k} onClick={() => setTab(t.k)} className={cn("inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px", tab === t.k ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground")}><t.Icon className="h-3.5 w-3.5" /> {t.label}</button>)}
      </div>

      {tab === "home" && <HomeTab onGo={setTab} onIndustry={(ind: any) => { setIndustryFilter(ind); setTab("templates"); }} />}
      {tab === "campaigns" && <CampaignsTab campaigns={campaigns} envs={envs} loading={loading} reload={load} />}
      {tab === "new" && <NewCampaign envs={envs} initialTemplateId={preselect} onCreated={() => { load(); setPreselect(""); setTab("campaigns"); }} />}
      {tab === "templates" && <TemplatesTab onUse={(id) => { setPreselect(id); setTab("new"); }} industry={industryFilter} onClearIndustry={() => setIndustryFilter(null)} />}
      {tab === "tools" && <ToolsTab />}
      {tab === "compliance" && <ComplianceTab />}
    </div>
  );
}

/* ───────────── Campaigns ───────────── */
function CampaignsTab({ campaigns, envs, loading, reload }: { campaigns: any[]; envs: any[]; loading: boolean; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [launchEnv, setLaunchEnv] = useState<Record<string, string>>({});
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, any>>({});

  const act = async (id: string, path: string, body?: any) => {
    setBusy(id + path);
    try { await fetch(`/api/phishing/campaigns/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "{}" }); await reload(); }
    finally { setBusy(null); }
  };
  const del = async (id: string) => { if (!confirm("Delete campaign?")) return; setBusy(id + "del"); try { await fetch(`/api/phishing/campaigns/${id}`, { method: "DELETE" }); await reload(); } finally { setBusy(null); } };

  const togglePreview = async (id: string) => {
    if (openPreview === id) { setOpenPreview(null); return; }
    setOpenPreview(id);
    if (!detail[id]) {
      const d = await fetch(`/api/phishing/campaigns/${id}`).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (d) setDetail((x) => ({ ...x, [id]: d }));
    }
  };

  if (loading) return <div className="py-8 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (campaigns.length === 0) return <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center text-sm text-muted-foreground">No campaigns yet — create one in <b>New Campaign</b>.</div>;

  return (
    <div className="space-y-2">
      {campaigns.map((c) => (
        <div key={c.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{c.name}</span>
            <span className="text-[10px] uppercase px-2 py-0.5 rounded-full border border-border text-muted-foreground">{c.mode}</span>
            <span className={cn("text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border", STATUS_STYLE[c.status] || STATUS_STYLE.draft)}>{c.status.replace("_", " ")}</span>
            <span className="text-[10px] text-muted-foreground">{c.techniques?.length || 0} techniques</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={() => togglePreview(c.id)} className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border text-muted-foreground px-2.5 py-1 hover:text-foreground"><FileText className="h-3 w-3" /> Preview</button>
              {c.status === "pending_approval" && <>
                <button onClick={() => act(c.id, "approve", { decision: "approve" })} disabled={!!busy} className="inline-flex items-center gap-1 text-[11px] rounded-md bg-success text-white px-2.5 py-1 hover:opacity-90 disabled:opacity-50"><BadgeCheck className="h-3 w-3" /> Approve</button>
                <button onClick={() => act(c.id, "approve", { decision: "reject" })} disabled={!!busy} className="inline-flex items-center gap-1 text-[11px] rounded-md border border-danger/40 text-danger px-2.5 py-1 hover:bg-danger/10 disabled:opacity-50"><Ban className="h-3 w-3" /> Reject</button>
              </>}
              {c.status === "approved" && <>
                <select value={launchEnv[c.id] || ""} onChange={(e) => setLaunchEnv((x) => ({ ...x, [c.id]: e.target.value }))} className="h-7 px-1.5 text-[11px] rounded border border-border bg-input text-foreground">
                  <option value="">env…</option>{envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <button onClick={() => act(c.id, "launch", { environmentId: launchEnv[c.id], mode: "simulate-only" })} disabled={!launchEnv[c.id] || !!busy} className="inline-flex items-center gap-1 text-[11px] rounded-md bg-accent text-white px-2.5 py-1 hover:bg-[#60a5fa] disabled:opacity-50">{busy === c.id + "launch" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Launch</button>
              </>}
              {["running", "approved", "pending_approval"].includes(c.status) && <button onClick={() => act(c.id, "abort")} disabled={!!busy} className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border text-muted-foreground px-2.5 py-1 hover:text-danger"><Ban className="h-3 w-3" /> Abort</button>}
              <button onClick={() => del(c.id)} disabled={!!busy} className="text-muted-foreground hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          {c.approval?.requestedBy && <div className="mt-1 text-[10px] text-muted-foreground">requested by {c.approval.requestedBy}{c.approval.approvedBy ? ` · ${c.approval.decision === "reject" ? "rejected" : "approved"} by ${c.approval.approvedBy}` : ""}</div>}

          {openPreview === c.id && (
            <div className="mt-2 rounded-lg border border-accent/30 bg-accent/[0.03] p-3 space-y-2">
              {!detail[c.id] ? <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> loading preview…</div> : (() => {
                const d = detail[c.id]; const g = d.generated || {}; const cfg = d.config || {};
                return (
                  <>
                    {d.mode === "ai" && cfg.scenario && <div className="text-[11px] text-muted-foreground">Scenario: {cfg.scenario} · persona: {cfg.targetPersona || "—"}</div>}
                    {d.mode === "tool" && cfg.toolId && <div className="text-[11px] text-muted-foreground">Framework: <span className="font-mono">{cfg.toolId}</span> — operator-deployed; campaign runs detection scoring.</div>}
                    {g.body
                      ? <EmailPreview subject={g.subject} body={g.body} kind={g.kind} category={cfg.category} company={(cfg.placeholderValues || {}).Company} to={(cfg.placeholderValues || {}).Name} />
                      : <div className="text-[11px] text-muted-foreground italic">No rendered lure content stored for this campaign.</div>}
                    {g.indicators?.length ? <div className="text-[10px] text-muted-foreground">indicators: {g.indicators.slice(0, 6).join("; ")}</div> : null}
                    <div className="text-[10px] font-mono text-accent">techniques: {(d.techniques || []).join(", ") || "—"}</div>
                  </>
                );
              })()}
            </div>
          )}

          {c.results?.status && (
            <div className="mt-2 rounded-lg border border-border bg-background/40 p-2 text-[11px]">
              <span className="font-semibold text-foreground inline-flex items-center gap-1.5">{c.results.status === "success" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-danger" />} Detection run {c.results.status}</span>
              <span className="text-muted-foreground"> · {c.results.stepCount} steps · {c.results.mappedTechniques?.length} techniques mapped</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ───────────── New campaign wizard ───────────── */
function NewCampaign({ envs, onCreated, initialTemplateId }: { envs: any[]; onCreated: () => void; initialTemplateId?: string }) {
  const [mode, setMode] = useState<"template" | "tool" | "ai">("template");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [ph, setPh] = useState<Record<string, string>>({});   // placeholder values
  const [toolId, setToolId] = useState("");
  const [scenario, setScenario] = useState("");
  const [persona, setPersona] = useState("finance employee");
  const [gen, setGen] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tplQuery, setTplQuery] = useState("");
  const [tplCat, setTplCat] = useState("all");

  useEffect(() => { fetch("/api/phishing/templates").then((r) => r.json()).then((d) => setTemplates(d.items || [])).catch(() => {}); fetch("/api/phishing/tools").then((r) => r.json()).then((d) => setTools(d.items || [])).catch(() => {}); }, []);

  // Preselect a template when arriving via "Use" from the gallery.
  useEffect(() => {
    if (!initialTemplateId || !templates.length) return;
    const t = templates.find((x) => x.id === initialTemplateId);
    if (!t) return;
    setMode("template"); setTemplateId(t.id);
    const init: Record<string, string> = {};
    for (const p of t.placeholders || []) init[p] = p.toLowerCase() === "company" ? "Acme Corp" : "";
    setPh(init);
    setName((cur) => cur || `${t.name} simulation`);
  }, [initialTemplateId, templates]);

  const generate = async () => {
    setGenerating(true); setErr(null);
    try { const d = await fetch("/api/phishing/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, targetPersona: persona }) }).then((r) => r.json()); if (d.ok) setGen(d.lure); else setErr(d.error || "generation failed"); }
    finally { setGenerating(false); }
  };

  const create = async () => {
    setSaving(true); setErr(null);
    const config: any = { consent };
    let generated: any = gen || {};
    if (mode === "template") {
      config.templateId = templateId;
      config.placeholderValues = ph;
      const tpl = templates.find((t) => t.id === templateId);
      if (tpl) {
        const fill = (s: string) => (s || "").replace(/\{(\w+)\}/g, (_m, k) => (ph[k] ? ph[k] : `{${k}}`));
        generated = { subject: fill(tpl.subject), body: fill(tpl.body), kind: tpl.kind };
        config.category = tpl.category;
      }
    }
    if (mode === "tool") config.toolId = toolId;
    if (mode === "ai") { config.scenario = scenario; config.targetPersona = persona; if (gen?.techniques?.length) config.techniques = gen.techniques; }
    try {
      const d = await fetch("/api/phishing/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mode, config, generated }) }).then((r) => r.json());
      if (!d.ok) { setErr(d.error || "create failed"); return; }
      onCreated();
    } finally { setSaving(false); }
  };

  const canCreate = name.trim() && consent && (mode === "template" ? templateId : mode === "tool" ? toolId : scenario.trim());

  return (
    <div className="space-y-4 max-w-3xl">
      {/* mode tabs */}
      <div className="grid grid-cols-3 gap-2">
        {[{ k: "template", label: "Template", Icon: FileText, d: "Static training lures" }, { k: "tool", label: "Framework", Icon: Boxes, d: "Gophish / Evilginx / …" }, { k: "ai", label: "AI Generated", Icon: Sparkles, d: "LLM-authored lure" }].map((m: any) => (
          <button key={m.k} onClick={() => setMode(m.k)} className={cn("rounded-xl border p-3 text-left transition-all", mode === m.k ? "border-accent/50 bg-accent/10" : "border-border hover:border-accent/30")}>
            <m.Icon className={cn("h-5 w-5", mode === m.k ? "text-accent" : "text-muted-foreground")} />
            <div className="mt-1.5 text-sm font-semibold text-foreground">{m.label}</div>
            <div className="text-[10px] text-muted-foreground">{m.d}</div>
          </button>
        ))}
      </div>

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" className="w-full h-9 px-3 text-sm rounded-md border border-border bg-input text-foreground" />

      {mode === "template" && (() => {
        const selectedTpl = templates.find((t) => t.id === templateId);
        const selectTpl = (t: any) => {
          setTemplateId(t.id);
          // seed placeholder values (prefill Company; leave others blank)
          const init: Record<string, string> = {};
          for (const p of t.placeholders || []) init[p] = p.toLowerCase() === "company" ? "Acme Corp" : "";
          setPh(init);
          if (!name.trim()) setName(`${t.name} simulation`);
        };
        const fill = (s: string) => (s || "").replace(/\{(\w+)\}/g, (_m, k) => (ph[k] ? ph[k] : `{${k}}`));
        const cats = ["all", ...Array.from(new Set(templates.map((t) => t.category)))];
        const shown = templates.filter((t) => (tplCat === "all" || t.category === tplCat) && (!tplQuery || t.name.toLowerCase().includes(tplQuery.toLowerCase())));
        return (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xs font-semibold text-foreground mr-1">Choose a template</div>
                <div className="relative flex-1 min-w-[160px]"><Sparkles className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" /><input value={tplQuery} onChange={(e) => setTplQuery(e.target.value)} placeholder="Search…" className="w-full h-8 pl-8 pr-2 text-xs rounded-md border border-border bg-input text-foreground" /></div>
                <div className="flex items-center gap-1 flex-wrap">{cats.map((c) => <button type="button" key={c} onClick={() => setTplCat(c)} className={cn("px-2 py-0.5 text-[10px] rounded-md border", tplCat === c ? "border-accent/50 bg-accent/15 text-accent" : "border-border text-muted-foreground hover:text-foreground")}>{c}</button>)}</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 max-h-[24rem] overflow-y-auto">
                {shown.map((t) => (
                  <button type="button" key={t.id} onClick={() => selectTpl(t)} className={cn("group relative text-left rounded-lg border overflow-hidden transition-all flex flex-col", templateId === t.id ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent/50")}>
                    <div className="relative border-b border-border"><EmailPreview body={t.body} kind={t.kind} compact />
                      {templateId === t.id && <span className="absolute top-1 right-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-accent text-white"><CheckCircle2 className="h-3.5 w-3.5" /></span>}
                    </div>
                    <div className="p-2">
                      <div className="text-[10.5px] font-medium text-foreground leading-tight line-clamp-2" title={t.name}>{t.name}</div>
                      <div className="mt-1 text-[9px] text-muted-foreground"><span className="px-1.5 py-0.5 rounded-full border border-border">{t.category}</span></div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* placeholder editor + live preview (the missing step) */}
            {selectedTpl && (
              <div className="rounded-xl border border-accent/30 bg-accent/[0.03] p-4 space-y-3">
                <div className="text-xs font-semibold text-foreground">Customize &amp; preview — {selectedTpl.name}</div>
                {(selectedTpl.placeholders || []).length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {(selectedTpl.placeholders || []).map((p: string) => (
                      <label key={p} className="block">
                        <span className="text-[10px] text-muted-foreground font-mono">{`{${p}}`}</span>
                        <input value={ph[p] || ""} onChange={(e) => setPh((x) => ({ ...x, [p]: e.target.value }))} placeholder={p} className="mt-0.5 w-full h-8 px-2 text-xs rounded border border-border bg-input text-foreground" />
                      </label>
                    ))}
                  </div>
                ) : <div className="text-[11px] text-muted-foreground">This template has no placeholders.</div>}
                <EmailPreview subject={fill(selectedTpl.subject)} body={fill(selectedTpl.body)} kind={selectedTpl.kind} category={selectedTpl.category} company={ph.Company || ph.company} to={ph.Name || ph.name} />
              </div>
            )}
          </div>
        );
      })()}
      {mode === "tool" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="text-xs font-semibold text-foreground">Choose a framework</div>
          <div className="rounded-md border border-info/30 bg-info/5 px-2.5 py-1.5 text-[10px] text-muted-foreground inline-flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 text-info" /> Framework deployment (Gophish/Evilginx/…) is operator-driven + isolated. The campaign records the choice + runs detection scoring; it does not auto-spin a live phishing server.</div>
          {tools.filter((t) => t.recommended).map((t) => (
            <label key={t.id} className={cn("block rounded-lg border p-3 cursor-pointer", toolId === t.id ? "border-accent/50 bg-accent/5" : "border-border")}>
              <div className="flex items-center gap-2"><input type="radio" checked={toolId === t.id} onChange={() => setToolId(t.id)} /><span className="text-sm font-medium text-foreground">{t.name}</span><span className="text-[10px] text-muted-foreground">{t.type} · {t.license}</span></div>
              <div className="mt-1 text-[11px] text-muted-foreground">{t.note}</div>
            </label>
          ))}
        </div>
      )}
      {mode === "ai" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="text-xs font-semibold text-foreground">Describe the scenario (AI generates a training lure)</div>
          <input value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="e.g. Urgent payroll update requiring re-login" className="w-full h-9 px-3 text-xs rounded border border-border bg-input text-foreground" />
          <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="target persona" className="w-full h-9 px-3 text-xs rounded border border-border bg-input text-foreground" />
          <button onClick={generate} disabled={!scenario.trim() || generating} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">{generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Generate lure</button>
          {gen && (
            <div className="space-y-1.5">
              <EmailPreview subject={gen.subject} body={gen.body} kind="email" category="ai" company={undefined} />
              {gen.techniques?.length ? <div className="text-[10px] font-mono text-accent">techniques: {gen.techniques.join(", ")}</div> : null}
              {gen.indicators?.length ? <div className="text-[10px] text-muted-foreground">indicators: {gen.indicators.slice(0, 4).join("; ")}</div> : null}
            </div>
          )}
        </div>
      )}

      <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        I confirm this simulation is authorized, targets only consenting systems, and will be audited. (Required)
      </label>
      {err && <div className="text-[11px] text-danger inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {err}</div>}
      <button onClick={create} disabled={!canCreate || saving} className="inline-flex items-center gap-1.5 h-10 px-5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />} Create campaign (→ pending approval)
      </button>
    </div>
  );
}

/* ───────────── Templates / Tools / Compliance ───────────── */
function TemplatesTab({ onUse, industry, onClearIndustry }: { onUse: (id: string) => void; industry?: any; onClearIndustry?: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);

  const load = useCallback(() => { setLoading(true); fetch("/api/phishing/templates").then((r) => r.json()).then((d) => setItems(d.items || [])).catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);

  const doImport = async () => { setImporting(true); try { await fetch("/api/phishing/templates/import", { method: "POST" }); load(); } finally { setImporting(false); } };

  const cats = ["all", ...Array.from(new Set(items.map((t) => t.category)))];
  const shown = items.filter((t) =>
    (cat === "all" || t.category === cat) &&
    (!q || t.name.toLowerCase().includes(q.toLowerCase())) &&
    (!industry || templateMatchesIndustry(t, industry.keywords)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]"><Sparkles className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="w-full h-9 pl-8 pr-2 text-xs rounded-md border border-border bg-input text-foreground" /></div>
        <div className="flex items-center gap-1 flex-wrap">{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={cn("px-2.5 py-1 text-[11px] rounded-md border", cat === c ? "border-accent/50 bg-accent/15 text-accent" : "border-border text-muted-foreground hover:text-foreground")}>{c}</button>)}</div>
        <button onClick={doImport} disabled={importing} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">{importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Import LinkSec</button>
      </div>
      {industry && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-[11px]">
          <span className="text-foreground font-medium">{industry.emoji} {industry.name}</span>
          <span className="text-muted-foreground">· {shown.length} matching template(s)</span>
          <button onClick={onClearIndustry} className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><XCircle className="h-3.5 w-3.5" /> clear filter</button>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">{shown.length} template(s) — click a card to preview, or <b>Use</b> to start a campaign.</div>

      {industry && shown.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center">
          <Mail className="h-7 w-7 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No {industry.name} templates yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">Industry-specific {industry.name} lures are coming in a future phase. For now, browse all templates or import more.</p>
          <button onClick={onClearIndustry} className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground">Show all templates</button>
        </div>
      ) : loading ? <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
          {shown.map((t) => (
            <div key={t.id} className="group rounded-lg border border-border bg-card overflow-hidden hover:border-accent/50 hover:shadow-[0_4px_20px_rgba(0,0,0,0.2)] transition-all flex flex-col">
              <button onClick={() => setPreview(t)} className="relative block text-left border-b border-border">
                <EmailPreview body={t.body} kind={t.kind} compact />
                {/* hover overlay with quick actions */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-md bg-white/90 text-black px-2 py-1"><Eye className="h-3 w-3" /> Preview</span>
                </div>
              </button>
              <div className="p-2 flex flex-col flex-1 gap-1.5">
                <div className="text-[11px] font-medium text-foreground leading-tight line-clamp-2" title={t.name}>{t.name}</div>
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded-full border border-border truncate">{t.category}</span>
                </div>
                <button onClick={() => onUse(t.id)} className="mt-auto inline-flex items-center justify-center gap-1 text-[10px] font-medium rounded-md bg-accent text-white px-2 py-1 hover:bg-[#60a5fa]"><Play className="h-2.5 w-2.5" /> Use</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* full-screen preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreview(null)}>
          <div className="bg-card border border-border rounded-xl max-w-3xl w-full max-h-[88vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold text-foreground">{preview.name}</div><button onClick={() => setPreview(null)} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button></div>
            <EmailPreview subject={preview.subject} body={preview.body} kind={preview.kind} category={preview.category} />
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => { onUse(preview.id); setPreview(null); }} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]"><Play className="h-3.5 w-3.5" /> Use this template</button>
              <span className="text-[10px] text-muted-foreground">{preview.sourceRef}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolsTab() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { fetch("/api/phishing/tools").then((r) => r.json()).then((d) => setItems(d.items || [])).catch(() => {}); }, []);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-[11px]">
        <thead className="text-muted-foreground border-b border-border"><tr className="text-left">{["Framework", "Type", "License", "Container", "Last release", "★", "Status"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-b border-border/50">
              <td className="px-3 py-2"><a href={t.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:text-accent">{t.name}</a></td>
              <td className="px-3 py-2 text-muted-foreground">{t.type}</td>
              <td className="px-3 py-2 text-muted-foreground">{t.license}</td>
              <td className="px-3 py-2 text-muted-foreground">{t.containerReady}</td>
              <td className="px-3 py-2 text-muted-foreground">{t.lastRelease}</td>
              <td className="px-3 py-2 text-muted-foreground">{t.stars}</td>
              <td className="px-3 py-2">{t.recommended ? <span className="text-success inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> recommended</span> : t.maintained ? <span className="text-muted-foreground">review</span> : <span className="text-danger">unmaintained</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComplianceTab() {
  const items = [
    { t: "Approval gate", d: "Every campaign is created in pending-approval and cannot launch until an admin approves it. Approver + timestamp are recorded." },
    { t: "Consent acknowledgement", d: "Creation requires confirming the simulation is authorized and targets only consenting systems." },
    { t: "Kill-switch", d: "One click aborts every pending/approved/running campaign immediately." },
    { t: "Audit trail", d: "Create, approve/reject, launch, complete, abort, AI-generation, and kill-switch are all written to the platform event log." },
    { t: "Dummy data only", d: "Templates and AI output use placeholders; no real credentials or working malicious payloads are stored." },
    { t: "Data minimisation (GDPR/NIS2/DORA)", d: "Record only what's needed (technique coverage + detection results); aggregate reporting; purge raw data after analysis." },
  ];
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {items.map((i) => (
        <div key={i.t} className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground flex items-center gap-1.5"><ShieldAlert className="h-4 w-4 text-warning" /> {i.t}</div>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{i.d}</p>
        </div>
      ))}
    </div>
  );
}

/* ───────────── Home — multi-domain coverage overview ───────────── */
const COV_ICONS: Record<string, any> = { Mail, Phone, Landmark, Users };
function HomeTab({ onGo, onIndustry }: { onGo: (t: Tab) => void; onIndustry: (ind: any) => void }) {
  const totalTemplates = PHISHGRID_COVERAGE.reduce((n, g) => n + g.templates.length, 0);
  const allTechniques = [...new Set(PHISHGRID_COVERAGE.flatMap((g) => g.techniques))];
  return (
    <div className="space-y-5">
      {/* hero */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-warning/[0.06] to-accent/[0.06] p-6">
        <div className="text-[11px] uppercase tracking-wider text-warning font-semibold">Attack Templates Library</div>
        <h2 className="mt-1 text-xl font-bold text-foreground">Crafting realistic threat environments</h2>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">Multi-domain, multi-vector phishing coverage — from brand-spoofing email to vishing, finance, healthcare, and social-engineering lures. Each domain maps to ATT&amp;CK techniques you can simulate and score.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {[{ v: INDUSTRY_COVERAGE.length, l: "industries covered" }, { v: PHISHGRID_COVERAGE.length, l: "attack domains" }, { v: totalTemplates, l: "vector templates" }, { v: allTechniques.length, l: "ATT&CK techniques" }].map((s) => (
            <div key={s.l} className="rounded-xl border border-border bg-card px-4 py-2"><div className="text-xl font-bold text-foreground">{s.v}</div><div className="text-[10px] text-muted-foreground">{s.l}</div></div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={() => onGo("templates")} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]"><LayoutGrid className="h-3.5 w-3.5" /> Browse templates</button>
          <button onClick={() => onGo("new")} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md border border-border text-foreground hover:bg-card-hover"><Plus className="h-3.5 w-3.5" /> New campaign</button>
        </div>
      </div>

      {/* industry / sector coverage */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2"><Landmark className="h-4 w-4 text-accent" /> Industry coverage</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {INDUSTRY_COVERAGE.map((ind) => (
            <button type="button" key={ind.name} onClick={() => onIndustry(ind)} className="group text-left rounded-xl border border-border bg-card p-3 hover:border-accent/50 hover:bg-card-hover transition-all">
              <div className="flex items-center gap-2"><span className="text-xl leading-none">{ind.emoji}</span><span className="text-[12px] font-semibold text-foreground">{ind.name}</span></div>
              <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{ind.blurb}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {ind.examples.slice(0, 4).map((e) => <span key={e} className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">{e}</span>)}
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <div className="flex flex-wrap gap-1">{ind.techniques.map((t) => <span key={t} className="text-[8px] font-mono px-1 py-0.5 rounded bg-accent/10 text-accent">{t}</span>)}</div>
                <span className="text-[9px] text-accent inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">templates <ArrowRight className="h-2.5 w-2.5" /></span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* attack-vector coverage groups */}
      <h3 className="text-sm font-semibold text-foreground -mb-1 flex items-center gap-2"><LayoutGrid className="h-4 w-4 text-accent" /> Attack-vector domains</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PHISHGRID_COVERAGE.map((g) => {
          const Icon = COV_ICONS[g.icon] || Mail;
          return (
            <div key={g.group} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent"><Icon className="h-5 w-5" /></span>
                <div><div className="text-sm font-semibold text-foreground">{g.group}</div><div className="text-[10px] text-muted-foreground">{g.vector} · {g.templates.length} templates</div></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {g.templates.map((t) => <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-background/40 text-[11px] text-foreground"><Mail className="h-3 w-3 text-muted-foreground" /> {t}</span>)}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                {g.techniques.map((tid) => <span key={tid} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-accent/30 bg-accent/5 text-accent">{tid}</span>)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-muted-foreground">{COVERAGE_SOURCE}</div>
    </div>
  );
}

/* ───────────── Inbox-style lure preview (safe sandboxed render) ───────────── */
function senderFor(category: string, company: string) {
  const co = company || "Acme Corp";
  const domain = (co.toLowerCase().replace(/[^a-z0-9]/g, "") || "company");
  switch (category) {
    case "credential-harvest": return { name: `${co} IT Service Desk`, addr: `it-servicedesk@${domain}-sso.com` };
    case "mfa-fatigue":         return { name: `${co} Security`,        addr: `security-noreply@${domain}.com` };
    case "link":                return { name: `${co} OneDrive`,        addr: `no-reply@sharepoint-${domain}.com` };
    case "attachment":          return { name: `Accounts Payable`,      addr: `billing@${domain}-invoices.com` };
    case "bec":                 return { name: `Office of the CEO`,      addr: `ceo@${domain}.com` };
    case "ai":                  return { name: `${co} Notifications`,    addr: `no-reply@${domain}.com` };
    default:                    return { name: co,                      addr: `no-reply@${domain}.com` };
  }
}

function buildSrcDoc(body: string): string {
  // Wrap the lure HTML in a clean white email document with a training banner.
  // Rendered inside a sandboxed iframe (no scripts, opaque origin) → safe.
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    html,body{margin:0}
    body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#ffffff;font-size:14px;line-height:1.55;padding:18px 20px}
    a{color:#2563eb} img{max-width:100%}
    .dops-sim{background:#fff8e1;border:1px solid #ffe082;color:#7a5c00;padding:7px 11px;border-radius:8px;font-size:12px;margin-bottom:14px}
  </style></head><body><div class="dops-sim">&#9888; Authorized phishing <b>simulation</b> &mdash; training content only. Do not act on this message.</div>${body || "<p style='color:#888'>(no content)</p>"}</body></html>`;
}

function EmailPreview({ subject, body, kind, category, company, to, compact }: { subject?: string; body?: string; kind?: string; category?: string; company?: string; to?: string; compact?: boolean }) {
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const sender = senderFor(category || "", company || "Acme Corp");
  const recipient = to || `you@${(company || "acme").toLowerCase().replace(/[^a-z0-9]/g, "") || "acme"}.com`;
  const initials = (sender.name.match(/\b\w/g) || ["?"]).slice(0, 2).join("").toUpperCase();
  // Filled in after mount, never during render. `toLocaleString` formats using
  // the RUNTIME's locale and timezone, so the server produced one string and the
  // browser another — a guaranteed hydration mismatch. (The current time itself
  // also differs between the two renders.) The preview timestamp is cosmetic, so
  // an empty first paint is fine.
  const [now, setNow] = useState("");
  useEffect(() => {
    setNow(new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  }, []);
  const isLanding = kind === "landing";

  // Gallery thumbnail: a scaled, non-interactive render of the full email.
  if (compact) {
    return (
      <div className="w-full h-28 overflow-hidden bg-white pointer-events-none">
        <iframe sandbox="" srcDoc={buildSrcDoc(body || "")} title="thumbnail" scrolling="no" tabIndex={-1}
          style={{ width: "1100px", height: "1500px", border: 0, transform: "scale(0.2)", transformOrigin: "top left" }} />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card">
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1.5">{isLanding ? <><Globe className="h-3 w-3" /> Landing page preview</> : <><Mail className="h-3 w-3" /> Inbox preview</>}</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button type="button" onClick={() => setView("rendered")} className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-[10px]", view === "rendered" ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Eye className="h-3 w-3" /> Rendered</button>
          <button type="button" onClick={() => setView("source")} className={cn("inline-flex items-center gap-1 px-2 py-0.5 text-[10px]", view === "source" ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Code2 className="h-3 w-3" /> Source</button>
        </div>
      </div>

      {view === "source" ? (
        <pre className="text-[10px] font-mono text-foreground/90 whitespace-pre-wrap break-words max-h-72 overflow-y-auto bg-black/40 p-3">{body || "(no content)"}</pre>
      ) : isLanding ? (
        <div className="bg-white">
          <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: "#e8eaed" }}>
            <span className="flex gap-1"><i className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: "#ff5f57" }} /><i className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: "#febc2e" }} /><i className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: "#28c840" }} /></span>
            <span className="flex-1 mx-2 rounded-md px-2 py-0.5 text-[11px] flex items-center gap-1.5" style={{ background: "#fff", color: "#3c4043" }}><Lock className="h-3 w-3" style={{ color: "#5f6368" }} /> https://login.{(company || "acme").toLowerCase().replace(/[^a-z0-9]/g, "")}-sso.com/auth</span>
          </div>
          <iframe sandbox="" srcDoc={buildSrcDoc(body || "")} title="landing preview" className="w-full bg-white" style={{ height: "20rem", border: "0" }} />
        </div>
      ) : (
        <div className="bg-white">
          <div className="px-4 pt-3 pb-3 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
            <div className="text-[15px] font-semibold" style={{ color: "#202124" }}>{subject || "(no subject)"}</div>
            <div className="flex items-center gap-2.5 mt-2.5">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#a855f7)" }}>{initials}</div>
              <div className="min-w-0">
                <div className="text-[12.5px]" style={{ color: "#202124" }}><b>{sender.name}</b> <span style={{ color: "#5f6368" }}>&lt;{sender.addr}&gt;</span></div>
                <div className="text-[11px]" style={{ color: "#5f6368" }}>to {recipient} &middot; {now}</div>
              </div>
              <div className="ml-auto flex items-center gap-3" style={{ color: "#5f6368" }}><Star className="h-4 w-4" /><CornerUpLeft className="h-4 w-4" /></div>
            </div>
          </div>
          <iframe sandbox="" srcDoc={buildSrcDoc(body || "")} title="email preview" className="w-full bg-white" style={{ height: "18rem", border: "0" }} />
        </div>
      )}
    </div>
  );
}
