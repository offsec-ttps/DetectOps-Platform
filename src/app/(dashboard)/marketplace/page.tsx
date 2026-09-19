"use client";

/**
 * Simulation Module Marketplace — browse / search / filter installable modules,
 * kick the validation worker, and jump to the builder. Mirrors the build-forge /
 * community catalog UI conventions.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Blocks, Search, Loader2, Plus, ShieldCheck, AlertTriangle, CheckCircle2, Clock, XCircle, RefreshCw, Hammer,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES = ["all", "ransomware", "phishing", "lateral-movement", "exfiltration", "persistence", "credential-access", "c2", "discovery", "impact", "other"];

const STATUS_STYLE: Record<string, string> = {
  live: "border-success/30 bg-success/10 text-success",
  approved: "border-info/30 bg-info/10 text-info",
  validating: "border-warning/30 bg-warning/10 text-warning",
  submitted: "border-border bg-muted/10 text-muted-foreground",
  rejected: "border-danger/30 bg-danger/10 text-danger",
  disabled: "border-border bg-muted/10 text-muted-foreground",
};
const STATUS_ICON: Record<string, any> = { live: CheckCircle2, approved: ShieldCheck, validating: Loader2, submitted: Clock, rejected: XCircle, disabled: XCircle };

export default function MarketplacePage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [ticking, setTicking] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const load = async () => {
    setLoading(true);
    const r = await fetch("/api/modules").then((x) => x.json()).catch(() => ({ items: [] }));
    setItems(r.items || []);
    setEnabled(r.marketplaceEnabled !== false);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const runValidation = async () => {
    setTicking(true);
    try { await fetch("/api/modules/validation/tick", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); await load(); }
    finally { setTicking(false); }
  };

  const shown = items.filter((m) =>
    (cat === "all" || m.category === cat) &&
    (!q || m.name.toLowerCase().includes(q.toLowerCase()) || m.moduleId.toLowerCase().includes(q.toLowerCase()) || (m.description || "").toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><Blocks className="h-6 w-6 text-accent" /> Module Marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">Install community + custom cyber-simulation modules, or build your own. Each module is validated by an AI agent before going live.</p>
        </div>
        <div className="inline-flex items-center gap-2">
          <button onClick={runValidation} disabled={ticking} className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
            {ticking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Run validation
          </button>
          <Link href="/marketplace/build" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]"><Hammer className="h-3.5 w-3.5" /> Build a module</Link>
        </div>
      </div>

      {!enabled && <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning inline-flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> Marketplace is disabled (set ENABLE_MODULE_MARKETPLACE=1).</div>}

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search modules…" className="w-full h-9 pl-8 pr-2 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn("px-2.5 py-1 text-[11px] rounded-md border transition-colors", cat === c ? "border-accent/50 bg-accent/15 text-accent" : "border-border text-muted-foreground hover:text-foreground")}>{c}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Blocks className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No modules yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">Build one in the playground, or upload a module.json.</p>
          <Link href="/marketplace/build" className="mt-3 inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]"><Plus className="h-3.5 w-3.5" /> Build a module</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((m) => {
            const SI = STATUS_ICON[m.status] || Clock;
            return (
              <Link key={m.moduleId} href={`/marketplace/${m.moduleId}`} className="group rounded-xl border border-border bg-card p-4 hover:border-accent/40 hover:bg-card-hover transition-all">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent"><Blocks className="h-5 w-5" /></span>
                  <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border", STATUS_STYLE[m.status] || STATUS_STYLE.submitted)}>
                    <SI className={cn("h-3 w-3", m.status === "validating" && "animate-spin")} /> {m.status}
                  </span>
                </div>
                <div className="mt-3 text-sm font-semibold text-foreground">{m.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{m.moduleId} · v{m.version}</div>
                <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-2">{m.description}</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="px-1.5 py-0.5 rounded border border-border">{m.category}</span>
                  {m.signatureState === "verified" && <span className="inline-flex items-center gap-1 text-success"><ShieldCheck className="h-3 w-3" /> signed</span>}
                  <span className="ml-auto">by {m.author}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
