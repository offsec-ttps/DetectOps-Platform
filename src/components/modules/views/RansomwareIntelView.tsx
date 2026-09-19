"use client";

/**
 * Built-in module view: self-hosted ransomware-gang intelligence (RansomLook-style).
 * Directory → gang detail (Overview / TTPs / IOCs / Signatures / Victims) +
 * "Simulate this gang" (→ /api/ransomware-intel/simulate → existing runner) +
 * an admin API-keys console. Driven by the catch-all `sub` segments:
 *   []                 → directory
 *   ["gang", <name>]   → gang detail
 *   ["keys"]           → API keys console
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Skull, Search, Loader2, RefreshCw, ChevronLeft, ChevronRight, ShieldAlert, Play, Crosshair,
  Network, FileWarning, ScrollText, Building2, Globe, ExternalLink, Sparkles, KeyRound, Plus, Trash2,
  CheckCircle2, XCircle, AlertTriangle, Copy, Server,
} from "lucide-react";
import { cn } from "@/lib/utils";

const shot = (ref?: string) => ref ? `/api/ransomware-intel/screenshot?ref=${encodeURIComponent(ref)}` : "";

export default function RansomwareIntelView({ moduleId, sub }: { moduleId: string; sub: string[] }) {
  if (sub[0] === "gang" && sub[1]) return <GangDetail moduleId={moduleId} name={decodeURIComponent(sub[1])} />;
  if (sub[0] === "keys") return <ApiKeysConsole moduleId={moduleId} />;
  return <Directory moduleId={moduleId} />;
}

/* ───────────── Directory ───────────── */
function Directory({ moduleId }: { moduleId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [status, setStatus] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch("/api/ransomware-intel/gangs").then((r) => r.json()).catch(() => ({ items: [] }));
    setItems(d.items || []); setLoading(false);
    fetch("/api/ransomware-intel/collect").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const collect = async () => { setCollecting(true); try { await fetch("/api/ransomware-intel/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await load(); } finally { setCollecting(false); } };

  const shown = items.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()) || (g.aliases || []).some((a: string) => a.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><Skull className="h-6 w-6 text-danger" /> Ransomware Intelligence</h1>
          <p className="mt-1 text-sm text-muted-foreground">Self-hosted gang directory — profiles, TTPs, IOCs, signatures, victims. Pick a gang to simulate its attack chain.</p>
        </div>
        <div className="inline-flex items-center gap-2">
          <Link href={`/modules/${moduleId}/keys`} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground"><KeyRound className="h-3.5 w-3.5" /> API Keys</Link>
          <button onClick={collect} disabled={collecting} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
            {collecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Collect now
          </button>
        </div>
      </div>

      {/* stats + collector status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Gangs tracked", v: items.length },
          { l: "Active", v: items.filter((g) => g.status === "active").length },
          { l: "With TTPs", v: items.filter((g) => g.hasTTPs).length },
          { l: "Total victims", v: items.reduce((n, g) => n + (g.victimCount || 0), 0) },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-border bg-card p-4"><div className="text-2xl font-bold text-foreground">{s.v}</div><div className="text-[11px] text-muted-foreground">{s.l}</div></div>
        ))}
      </div>
      {status?.collectors && (
        <div className="flex flex-wrap gap-2 text-[10px]">
          {status.collectors.map((c: any) => (
            <span key={c.id} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border", c.active ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground")}>
              {c.active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {c.name}
            </span>
          ))}
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search gangs…" className="w-full h-9 pl-8 pr-2 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
      </div>

      {loading ? <div className="py-10 flex justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((g) => (
            <Link key={g.name} href={`/modules/${moduleId}/gang/${encodeURIComponent(g.name)}`} className="group rounded-xl border border-border bg-card p-4 hover:border-danger/40 hover:bg-card-hover transition-all">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-danger/30 bg-danger/10 text-danger"><Skull className="h-5 w-5" /></span>
                <span className={cn("text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border", g.status === "active" ? "border-danger/30 bg-danger/10 text-danger" : "border-border text-muted-foreground")}>{g.status}</span>
              </div>
              <div className="mt-3 text-sm font-semibold text-foreground">{g.name}</div>
              {(g.aliases || []).length > 0 && <div className="text-[10px] text-muted-foreground">aka {g.aliases.join(", ")}</div>}
              <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-2">{g.description}</p>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Crosshair className="h-3 w-3" /> {(g.knownTTPs || []).length} TTPs</span>
                <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> {g.victimCount} victims</span>
                <span className="ml-auto inline-flex items-center gap-1 text-accent group-hover:gap-1.5 transition-all">Open <ChevronRight className="h-3 w-3" /></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── Gang detail ───────────── */
function GangDetail({ moduleId, name }: { moduleId: string; name: string }) {
  const [g, setG] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [enriching, setEnriching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch(`/api/ransomware-intel/gangs/${encodeURIComponent(name)}`).then((r) => r.ok ? r.json() : null).catch(() => null);
    setG(d); setLoading(false);
  }, [name]);
  useEffect(() => { load(); }, [load]);

  const enrich = async () => { setEnriching(true); try { await fetch(`/api/ransomware-intel/gangs/${encodeURIComponent(name)}/enrich`, { method: "POST" }); await load(); } finally { setEnriching(false); } };

  if (loading) return <div className="p-2 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!g || g.error) return <div className="space-y-3"><Link href={`/modules/${moduleId}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Directory</Link><div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">Gang not found.</div></div>;

  const ttpsByTactic: Record<string, any[]> = {};
  for (const t of g.knownTTPs || []) { (ttpsByTactic[t.tactic || "other"] ||= []).push(t); }
  const TABS = [
    { k: "overview", label: "Overview" }, { k: "ttps", label: `TTPs (${(g.knownTTPs || []).length})` },
    { k: "iocs", label: "IOCs" }, { k: "signatures", label: "Signatures" }, { k: "victims", label: `Victims (${(g.victims || []).length})` },
  ];

  return (
    <div className="space-y-4">
      <Link href={`/modules/${moduleId}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Directory</Link>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-danger/30 bg-danger/10 text-danger"><Skull className="h-7 w-7" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">{g.name}
            <span className={cn("text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border", g.status === "active" ? "border-danger/30 bg-danger/10 text-danger" : "border-border text-muted-foreground")}>{g.status}</span>
            <span className="text-[10px] text-muted-foreground">source: {g.source}</span>
          </h1>
          {(g.aliases || []).length > 0 && <div className="text-xs text-muted-foreground">aka {g.aliases.join(", ")}</div>}
          <p className="mt-1 text-sm text-muted-foreground max-w-3xl">{g.description}</p>
        </div>
      </div>

      <SimulatePanel gangName={g.name} ttpCount={(g.knownTTPs || []).length} onEnrich={enrich} enriching={enriching} />

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => <button key={t.k} onClick={() => setTab(t.k)} className={cn("px-3 py-2 text-xs font-medium border-b-2 -mb-px", tab === t.k ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>)}
      </div>

      {tab === "overview" && (
        <div className="grid md:grid-cols-2 gap-3">
          <Card title="Leak sites" icon={<Globe className="h-4 w-4" />}>
            {(g.leakSiteUrls || []).length ? <ul className="space-y-1 text-[11px] font-mono text-muted-foreground break-all">{g.leakSiteUrls.map((u: string) => <li key={u}>{u}</li>)}</ul> : <Empty>No leak sites recorded.</Empty>}
          </Card>
          <Card title="Targeted sectors" icon={<Building2 className="h-4 w-4" />}>
            <div className="flex flex-wrap gap-1.5">{(g.targetSectors || []).map((s: string) => <span key={s} className="px-2 py-0.5 rounded-md border border-border text-[11px] text-muted-foreground">{s}</span>)}</div>
          </Card>
          {g.screenshotRef && <Card title="Leak-site screenshot" icon={<ExternalLink className="h-4 w-4" />}><img src={shot(g.screenshotRef)} alt="leak site" className="rounded-md border border-border max-h-64 object-contain" /></Card>}
          <Card title="References" icon={<ScrollText className="h-4 w-4" />}>
            {(g.references || []).length ? <ul className="space-y-1 text-[11px]">{g.references.map((r: any) => <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">{r.title} <ExternalLink className="h-3 w-3" /></a></li>)}</ul> : <Empty>None.</Empty>}
          </Card>
        </div>
      )}
      {tab === "ttps" && (
        (g.knownTTPs || []).length ? (
          <div className="space-y-3">{Object.entries(ttpsByTactic).map(([tactic, ts]) => (
            <Card key={tactic} title={tactic.replace(/-/g, " ")} icon={<Crosshair className="h-4 w-4" />}>
              <div className="flex flex-wrap gap-2">{ts.map((t) => <span key={t.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-background/40 text-[11px]"><span className="font-mono text-accent">{t.id}</span> <span className="text-muted-foreground">{t.name}</span></span>)}</div>
            </Card>
          ))}</div>
        ) : <Empty>No TTPs yet — use <strong>Enrich with AI</strong> above to derive them from the profile.</Empty>
      )}
      {tab === "iocs" && <IocTab iocs={g.iocs} />}
      {tab === "signatures" && (
        <Card title="Detection signatures" icon={<ShieldAlert className="h-4 w-4" />}>
          {(g.signatures || []).length ? <ul className="space-y-1 text-[11px]">{g.signatures.map((s: any, i: number) => <li key={i} className="font-mono text-muted-foreground"><span className="text-accent uppercase">{s.kind}</span> {s.name}{s.ref ? ` · ${s.ref}` : ""}</li>)}</ul> : <Empty>No signatures recorded.</Empty>}
        </Card>
      )}
      {tab === "victims" && (
        <Card title="Recent victims" icon={<Building2 className="h-4 w-4" />}>
          {(g.victims || []).length ? (
            <div className="divide-y divide-border">{g.victims.map((v: any, i: number) => (
              <div key={i} className="py-1.5 flex items-center gap-2 text-[11px]">
                <span className="text-foreground font-medium">{v.victim}</span>
                {v.sector && <span className="text-muted-foreground">· {v.sector}</span>}
                {v.country && <span className="text-muted-foreground inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {v.country}</span>}
                <span className="ml-auto text-muted-foreground">{v.discoveredAt ? new Date(v.discoveredAt).toLocaleDateString() : ""}</span>
                {v.postUrl && <a href={v.postUrl} target="_blank" rel="noreferrer" className="text-accent"><ExternalLink className="h-3 w-3" /></a>}
              </div>
            ))}</div>
          ) : <Empty>No victim posts collected yet — run <strong>Collect now</strong> from the directory.</Empty>}
        </Card>
      )}
    </div>
  );
}

function IocTab({ iocs }: { iocs: any }) {
  const groups: Array<{ k: string; label: string; icon: any }> = [
    { k: "network", label: "Network", icon: Network }, { k: "file", label: "File", icon: FileWarning }, { k: "behavioral", label: "Behavioral", icon: Crosshair },
  ];
  const any = groups.some((gr) => (iocs?.[gr.k] || []).length);
  if (!any) return <Empty>No IOCs recorded — enrich the gang to populate IOC categories.</Empty>;
  return <div className="grid md:grid-cols-3 gap-3">{groups.map((gr) => (
    <Card key={gr.k} title={gr.label} icon={<gr.icon className="h-4 w-4" />}>
      {(iocs?.[gr.k] || []).length ? <ul className="space-y-1 text-[11px] font-mono text-muted-foreground break-all">{iocs[gr.k].map((v: string, i: number) => <li key={i}>{v}</li>)}</ul> : <Empty>—</Empty>}
    </Card>
  ))}</div>;
}

/* ───────────── Simulate panel ───────────── */
function SimulatePanel({ gangName, ttpCount, onEnrich, enriching }: { gangName: string; ttpCount: number; onEnrich: () => void; enriching: boolean }) {
  const [envs, setEnvs] = useState<any[]>([]);
  const [envId, setEnvId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetch("/api/environment-targets").then((r) => r.json()).then((d) => setEnvs(d.items || d.environments || [])).catch(() => {}); }, []);

  const run = async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/ransomware-intel/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gangName, environmentId: envId, mode: "simulate-only" }) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "simulation failed"); return; }
      setResult(d);
    } finally { setRunning(false); }
  };

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold text-foreground flex items-center gap-2"><Play className="h-4 w-4 text-accent" /> Simulate this gang</div>
        <button onClick={onEnrich} disabled={enriching} className="inline-flex items-center gap-1.5 text-[11px] rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50">{enriching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Enrich with AI</button>
      </div>
      <p className="text-[11px] text-muted-foreground">Maps {gangName}'s {ttpCount} TTPs to curated Atomic Red Team tests and runs them through the simulation engine (simulate-only).</p>
      <div className="flex items-center gap-2 flex-wrap">
        <Server className="h-3.5 w-3.5 text-muted-foreground" />
        <select value={envId} onChange={(e) => setEnvId(e.target.value)} className="flex-1 min-w-[200px] h-8 px-2 text-xs rounded border border-border bg-input text-foreground">
          <option value="">Select environment…</option>
          {envs.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.kind})</option>)}
        </select>
        <button onClick={run} disabled={!envId || running || ttpCount === 0} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Launch
        </button>
      </div>
      {error && <div className="text-[11px] text-danger inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {error}</div>}
      {result && (
        <div className="rounded-lg border border-border bg-background/40 p-3 space-y-1">
          <div className="text-xs font-semibold text-foreground flex items-center gap-2">{result.status === "success" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-danger" />} Run {result.status} · {result.stepCount} steps · {result.mappedTechniques?.length} techniques mapped{result.droppedTechniques?.length ? ` (${result.droppedTechniques.length} unmapped)` : ""}</div>
          {(result.stepResults || []).slice(0, 12).map((s: any, i: number) => <div key={i} className="text-[10px] font-mono text-muted-foreground"><span className={cn("uppercase font-bold", s.status === "ok" ? "text-success" : s.status === "stubbed" ? "text-warning" : "text-danger")}>{s.status}</span> · {s.framework} · {(s.notes || "").slice(0, 60)}</div>)}
        </div>
      )}
    </div>
  );
}

/* ───────────── API keys console ───────────── */
function ApiKeysConsole({ moduleId }: { moduleId: string }) {
  const [keys, setKeys] = useState<any[]>([]);
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setLoading(true); const d = await fetch("/api/ransomware-intel/keys").then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })); setKeys(d.items || []); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  const mint = async () => { const d = await fetch("/api/ransomware-intel/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label || "API key" }) }).then((r) => r.json()); if (d.key) { setMinted(d.key); setLabel(""); load(); } };
  const revoke = async (id: string) => { await fetch(`/api/ransomware-intel/keys/${id}`, { method: "DELETE" }); load(); };

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href={`/modules/${moduleId}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Directory</Link>
      <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><KeyRound className="h-6 w-6 text-accent" /> Intel API Keys</h1>
      <p className="text-sm text-muted-foreground">Issue keys for the public read-only intel API. Keys are shown once and rate-limited per key.</p>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label (e.g. partner-soc)" className="flex-1 h-9 px-2 text-xs rounded border border-border bg-input text-foreground" />
          <button onClick={mint} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]"><Plus className="h-3.5 w-3.5" /> Mint key</button>
        </div>
        {minted && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3">
            <div className="text-[11px] text-success font-semibold mb-1">Copy this key now — it won't be shown again:</div>
            <div className="flex items-center gap-2"><code className="flex-1 text-[11px] font-mono text-foreground break-all">{minted}</code><button onClick={() => navigator.clipboard?.writeText(minted)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button></div>
          </div>
        )}
        <div className="text-[11px] text-muted-foreground font-mono mt-1">curl -H "X-API-Key: rgi_…" {typeof window !== "undefined" ? window.location.origin : ""}/api/ransomware-intel/v1/groups</div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold text-foreground mb-2">Issued keys</div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : keys.length === 0 ? <Empty>No keys yet.</Empty> : (
          <div className="divide-y divide-border">{keys.map((k) => (
            <div key={k.id} className="py-2 flex items-center gap-2 text-[11px]">
              <code className="font-mono text-foreground">rgi_{k.prefix}…</code>
              <span className="text-muted-foreground">{k.label}</span>
              <span className={cn("uppercase text-[9px] font-bold", k.enabled ? "text-success" : "text-danger")}>{k.enabled ? "active" : "revoked"}</span>
              <span className="text-muted-foreground">· {k.requestCount} reqs · {k.rateLimitPerMin}/min</span>
              {k.enabled && <button onClick={() => revoke(k.id)} className="ml-auto text-muted-foreground hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          ))}</div>
        )}
      </div>
    </div>
  );
}

/* ───────────── small helpers ───────────── */
function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-4"><div className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5 capitalize">{icon} {title}</div>{children}</div>;
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="text-[11px] text-muted-foreground italic">{children}</div>; }
