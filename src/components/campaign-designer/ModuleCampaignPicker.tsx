"use client";

/**
 * ModuleCampaignPicker — pick Attack-Simulation module techniques (Active
 * Directory, Privilege Escalation, Lateral Movement, UAC Bypass, Cloud,
 * Container, Hacktools, ClickFix, Phishing, APT, Ransomware, …) straight into a
 * Campaign Designer selection, without leaving Step 2. Libraries are filtered to
 * the selected server's OS; techniques resolve to their real ART atomic tests
 * (plus a PurpleSharp row where supported). Adds route into the designer's normal
 * technique flow (techniqueList + per-technique tests/engine), the same path the
 * Attack-catalog handoff uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, Plus, Boxes, CheckSquare, Square, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { purpleSharpSupports } from "@/config/attack-libraries/purplesharp";

export interface ModuleAddPayload {
  techniques: string[];
  tests: Record<string, number>;
  testLists: Record<string, number[]>;
  engines: Record<string, "art" | "purplesharp">;
}

interface ModMeta { moduleId: string; name: string; category: string; }
interface Row { techniqueId: string; techniqueName: string; testNumber: number; testName: string; executor: string; platforms: string[]; engine: "art" | "purplesharp"; selKey: string; }

function normOs(os: string | undefined): "windows" | "linux" | "macos" | "" {
  const s = (os || "").toLowerCase();
  if (/win/.test(s)) return "windows";
  if (/linux|ubuntu|debian|centos|rhel|fedora|kali/.test(s)) return "linux";
  if (/mac|darwin|osx/.test(s)) return "macos";
  return "";
}

// Windows-only disciplines (AD + the Windows escalation libraries): their shared
// ATT&CK techniques may carry Linux/macOS atomics we strip to stay on-platform.
const WIN_ONLY = new Set(["active-directory", "uac-bypass", "user-to-admin", "user-to-system"]);
// Category → server OS the module is relevant to. Unknown categories show on every
// OS and are then filtered precisely at the atomic (platform) level.
const MODULE_PLATFORMS: Record<string, "windows" | "linux" | "macos"> = {
  "active-directory": "windows", "uac-bypass": "windows", "user-to-admin": "windows", "user-to-system": "windows",
  "cloud": "linux", "container": "linux",
};
function moduleFitsOs(category: string, os: "windows" | "linux" | "macos" | ""): boolean {
  if (!os) return true;
  const p = MODULE_PLATFORMS[category];
  return !p || p === os;
}
function atomicFitsOs(platforms: string[], os: "windows" | "linux" | "macos" | ""): boolean {
  if (!os) return true;
  if (!platforms?.length) return true;              // platform-agnostic test
  return platforms.some((p) => normOs(p) === os || p.toLowerCase() === "multi");
}

export default function ModuleCampaignPicker({ serverOs, selectedTechniques, onAdd }: { serverOs?: string; selectedTechniques: Set<string>; onAdd: (p: ModuleAddPayload) => void }) {
  const os = normOs(serverOs);
  const [mods, setMods] = useState<ModMeta[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [moduleId, setModuleId] = useState("");
  const [allRows, setAllRows] = useState<Row[]>([]);
  const loadSeq = useRef(0);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/simulations").then((r) => r.json()).then((d) => {
      // The live attack-catalog libraries (the same list Attack Simulations shows). LOTL has
      // its own picker; phishing / APT / ransomware use other data models.
      const items: ModMeta[] = (d.items || [])
        .filter((m: any) => m.view === "attack-catalog" && m.moduleId && m.moduleId !== "detectops.lotl-sim")
        .map((m: any) => ({ moduleId: m.moduleId, name: m.name, category: m.category || "" }));
      setMods(items);
    }).catch(() => {});
  }, []);

  const visibleMods = (showAll || !os) ? mods : mods.filter((m) => moduleFitsOs(m.category, os));
  const hiddenCount = mods.length - visibleMods.length;

  useEffect(() => {
    if (!visibleMods.length) { setModuleId(""); return; }
    if (!visibleMods.some((m) => m.moduleId === moduleId)) { setModuleId(visibleMods[0].moduleId); setChecked(new Set()); }
  }, [visibleMods, moduleId]);

  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setSearch(searchInput), 300);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [searchInput]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;          // ignore responses for a module the user already left
    if (!moduleId) { setAllRows([]); return; }
    setLoading(true);
    try {
      const mod = await fetch(`/api/modules/${moduleId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const catalog: any[] = mod?.manifest?.contributes?.catalog || [];
      // Keyed by `uid` (defaults to the ATT&CK id): a module may list several named
      // entries under one id; `match` narrows an entry to its own atomic tests and
      // `[]` makes it coverage-only. Mirrors the Attack-catalog list view.
      const meta = new Map<string, { tid: string; name: string; match?: string[] }>();
      for (const g of catalog) for (const t of (g.techniques || [])) {
        const uid = t.uid || t.id;
        if (!meta.has(uid)) meta.set(uid, { tid: t.id, name: t.name, match: t.match });
      }
      // Unique ids, most specific first, so sub-technique atomics are not claimed by a listed parent.
      const ids = [...new Set([...meta.values()].map((v) => v.tid))].sort((a, b) => b.length - a.length);
      const winOnly = WIN_ONLY.has(mod?.category);
      const out: Row[] = [];
      const claimed = new Set<string>();
      if (ids.length) {
        const d = await fetch(`/api/attack/atomics?techniques=${ids.join(",")}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
        const byTech: Record<string, any[]> = {};
        for (const a of (d.items || [])) (byTech[a.requestedId] ||= []).push(a);
        for (const [uid, m] of meta) {
          const id = m.tid;
          let atoms = (byTech[id] || []).filter((a: any) => !winOnly || !(a.platforms?.length) || a.platforms.includes("windows"));
          if (m.match) {
            const terms = m.match.map((s) => s.toLowerCase());
            atoms = atoms.filter((a: any) => terms.some((s) => (a.testName || "").toLowerCase().includes(s)));
          }
          // Use the atomic's REAL technique id: a sub-technique test grouped under a listed
          // parent id must run as itself, not as "<parent> #n" (a different test).
          for (const a of atoms) {
            const tid = a.techniqueId || id;
            const sk = `${tid}:${a.testNumber}`;
            if (!a.command || claimed.has(sk)) continue;
            claimed.add(sk);
            out.push({ techniqueId: tid, techniqueName: m.name, testNumber: a.testNumber, testName: a.testName, executor: a.executor || "—", platforms: a.platforms || [], engine: "art", selKey: sk });
          }
          if (m.match === undefined && purpleSharpSupports(id)) out.push({ techniqueId: id, techniqueName: m.name, testNumber: 0, testName: "PurpleSharp technique simulation (native AD)", executor: "PurpleSharp", platforms: ["windows"], engine: "purplesharp", selKey: `ps:${uid}` });
        }
      }
      if (seq === loadSeq.current) setAllRows(out);
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, [moduleId]);
  useEffect(() => { load(); }, [load]);

  // OS + search are client-side filters over the loaded module (no refetch per keystroke).
  const rows = useMemo(() => {
    let out = os ? allRows.filter((r) => r.engine === "purplesharp" ? os === "windows" : atomicFitsOs(r.platforms, os)) : allRows;
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => r.techniqueId.toLowerCase().includes(q) || r.techniqueName.toLowerCase().includes(q) || r.testName.toLowerCase().includes(q));
    }
    return out;
  }, [allRows, os, search]);

  const buildPayload = (rs: Row[]): ModuleAddPayload => {
    const techniques = [...new Set(rs.map((r) => r.techniqueId))];
    const tests: Record<string, number> = {};
    const testLists: Record<string, number[]> = {};
    const engines: Record<string, "art" | "purplesharp"> = {};
    for (const r of rs) {
      if (r.engine === "purplesharp") { engines[r.techniqueId] = "purplesharp"; continue; }
      (testLists[r.techniqueId] ||= []).push(r.testNumber);
      if (tests[r.techniqueId] == null) tests[r.techniqueId] = r.testNumber;
      if (!engines[r.techniqueId]) engines[r.techniqueId] = "art";
    }
    return { techniques, tests, testLists, engines };
  };

  const addChecked = () => {
    const rs = rows.filter((r) => checked.has(r.selKey));
    if (rs.length) onAdd(buildPayload(rs));
    setChecked(new Set());
  };
  const addAll = () => { if (rows.length) onAdd(buildPayload(rows)); setChecked(new Set()); };

  const curMod = mods.find((m) => m.moduleId === moduleId);

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Boxes className="h-4 w-4 text-accent" />
        <span className="text-xs font-semibold text-foreground">Attack-simulation modules</span>
        <select value={moduleId} onChange={(e) => { setModuleId(e.target.value); setChecked(new Set()); }} className="h-7 px-2 text-[11px] rounded border border-border bg-input text-foreground">
          {visibleMods.map((m) => <option key={m.moduleId} value={m.moduleId}>{m.name}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search techniques…" className="w-full h-7 pl-7 pr-2 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </div>
      </div>
      {os && (
        <p className="text-[10px] text-muted-foreground">
          Showing modules &amp; tests runnable on the selected <span className="text-foreground font-medium">{os}</span> server.
          {hiddenCount > 0 && <> {hiddenCount} incompatible {hiddenCount === 1 ? "module" : "modules"} hidden. </>}
          <button type="button" onClick={() => setShowAll((v) => !v)} className="ml-1 underline hover:text-foreground">{showAll ? "Filter to this OS" : "Show all"}</button>
        </p>
      )}

      <div className="rounded border border-border divide-y divide-border/50 max-h-56 overflow-y-auto">
        {loading ? (
          <div className="py-6 text-center text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin inline" /> Loading {curMod?.name || "module"}…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-muted-foreground">No runnable techniques for this module on {os || "the target"}.</div>
        ) : rows.map((r) => {
          const already = selectedTechniques.has(r.techniqueId);
          const on = checked.has(r.selKey);
          return (
            <button key={r.selKey} onClick={() => setChecked((prev) => { const n = new Set(prev); n.has(r.selKey) ? n.delete(r.selKey) : n.add(r.selKey); return n; })}
              className={cn("w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px]", on ? "bg-accent/5" : "hover:bg-card-hover")}>
              {on ? <CheckSquare className="h-3.5 w-3.5 text-accent shrink-0" /> : <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <span className="flex-1 truncate text-foreground">{r.techniqueName}{r.testNumber ? <span className="text-muted-foreground"> · #{r.testNumber}</span> : null}</span>
              <span className="font-mono text-accent shrink-0">{r.techniqueId}</span>
              <span className="text-muted-foreground shrink-0">{r.executor}</span>
              {already && <span className="text-[9px] text-success shrink-0">in campaign</span>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="text-muted-foreground">{rows.length} runnable test(s){curMod ? ` · ${curMod.name}` : ""}</span>
        <div className="flex-1" />
        <button onClick={addChecked} disabled={checked.size === 0} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Plus className="h-3 w-3" /> Add {checked.size || ""} checked
        </button>
        <button onClick={addAll} disabled={rows.length === 0} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
          <Layers className="h-3 w-3" /> Add all {rows.length || ""}
        </button>
      </div>
    </div>
  );
}
