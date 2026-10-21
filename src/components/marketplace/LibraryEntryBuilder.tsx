"use client";

/**
 * LibraryEntryBuilder — Module Builder tab: add ONE new technique to an EXISTING
 * library (AD, Privilege Escalation, Shellcode Injection, LOTL libraries, …) as an
 * atomic-style YAML record. Pick the library → fill the template → live-validate
 * (structure + linked-atomic resolution) → publish. Published entries are merged into
 * the library at read time, so they appear in the list view, technique cards, the
 * Campaign Designer picker and coverage scoping with no code change or redeploy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, Rocket, Save, Download, Upload, Trash2, Pencil, Archive, RotateCcw, FilePlus2, ListChecks, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Target { id: string; name: string; kind: "technique" | "lotl"; view: string; description: string; platform?: string; techniqueCount: number; entryCount: number; groups: Array<{ name: string; domains: string[] }> }
interface Validation {
  ok: boolean; errors: string[]; warnings: string[]; exists?: boolean; nextVersion?: number; key?: string; kind?: string; willBePending?: boolean;
  target?: { id: string; name: string; kind: string } | null;
  resolved?: Array<{ technique: string; name_includes: string[]; matched: Array<{ testNumber: number; testName: string; platforms: string[] }> }>;
  preview?: Array<{ id: string; name: string; uid: string; match?: string[] }>;
}
interface EntryItem { id: string; kind: string; moduleId: string; entryKey: string; name: string; attackId: string; status: string; version: number; updatedAt: string; createdBy: string }

const STATUS_STYLE: Record<string, string> = {
  published: "border-success/40 text-success bg-success/10", pending: "border-warning/40 text-warning bg-warning/10",
  draft: "border-border text-muted-foreground bg-card", retired: "border-border text-muted-foreground/60 bg-card line-through",
};

export default function LibraryEntryBuilder() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [library, setLibrary] = useState("");
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [val, setVal] = useState<Validation | null>(null);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [entries, setEntries] = useState<EntryItem[]>([]);
  const [importText, setImportText] = useState("");
  const [importRes, setImportRes] = useState<any>(null);
  const reqId = useRef(0);

  const target = targets.find((t) => t.id === library);

  useEffect(() => {
    fetch("/api/library-entries/targets").then((r) => r.json()).then((d) => {
      const ts: Target[] = d.targets || [];
      setTargets(ts);
      if (ts.length) setLibrary((cur) => cur || (ts.find((t) => t.id === "detectops.shellcode-injection-sim") || ts[0]).id);
    }).catch(() => {});
  }, []);

  const loadEntries = useCallback(async () => {
    if (!library) return;
    const d = await fetch(`/api/library-entries?library=${encodeURIComponent(library)}`).then((r) => r.json()).catch(() => ({ items: [] }));
    setEntries(d.items || []);
  }, [library]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  const loadTemplate = useCallback(async (force = false) => {
    if (!library || !target) return;
    if (dirty && !force) return;
    const g = target.groups[0];
    const qs = new URLSearchParams({ kind: target.kind, library, group: g?.name || "Windows", domain: g?.domains?.[0] || "Analyst-added" });
    setText(await fetch(`/api/library-entries/template?${qs}`).then((r) => r.text()));
    setDirty(false); setVal(null); setMsg(null);
  }, [library, target, dirty]);
  // A library switch loads that library's template unless the author has unsaved edits.
  useEffect(() => { if (target) loadTemplate(false); /* eslint-disable-next-line */ }, [library, targets.length]);

  // Debounced live validation.
  useEffect(() => {
    if (!text.trim()) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setValidating(true);
      try {
        const r = await fetch("/api/library-entries/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yaml: text }) });
        const d = await r.json();
        if (id === reqId.current) setVal(d);
      } catch { if (id === reqId.current) setVal({ ok: false, errors: ["validation request failed"], warnings: [] }); }
      finally { if (id === reqId.current) setValidating(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [text]);

  const save = async (publish: boolean) => {
    setBusy(publish ? "publish" : "draft"); setMsg(null);
    try {
      const r = await fetch("/api/library-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yaml: text, publish }) });
      const d = await r.json();
      if (!r.ok) setMsg({ ok: false, text: (d.errors || [d.error || "save failed"]).join(" · ") });
      else { setMsg({ ok: true, text: `${d.note} (${d.library} / ${d.key} · v${d.version})` }); setDirty(false); await loadEntries(); }
    } finally { setBusy(null); }
  };

  const act = async (id: string, status: string) => {
    setBusy(id);
    const r = await fetch(`/api/library-entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? { ok: true, text: `Entry ${status}.` } : { ok: false, text: d.error || "failed" });
    setBusy(null); loadEntries();
  };
  const del = async (e: EntryItem) => {
    if (!confirm(`Delete "${e.name}" from ${target?.name || e.moduleId}? It will disappear from the library.`)) return;
    setBusy(e.id); await fetch(`/api/library-entries/${e.id}`, { method: "DELETE" }); setBusy(null); loadEntries();
  };
  const edit = async (e: EntryItem) => {
    const d = await fetch(`/api/library-entries/${e.id}`).then((r) => r.json());
    setText(d.yaml || ""); setDirty(true); setMsg({ ok: true, text: `Editing ${e.entryKey} (v${e.version}) — saving creates v${e.version + 1}.` });
  };

  const doImport = async (dryRun: boolean) => {
    setBusy("import");
    try {
      const r = await fetch("/api/library-entries/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yaml: importText, dryRun }) });
      setImportRes(await r.json());
      if (!dryRun) loadEntries();
    } finally { setBusy(null); }
  };
  const onFile = async (f?: File | null) => { if (f) setImportText(await f.text()); };

  const grouped = useMemo(() => ({
    technique: targets.filter((t) => t.kind === "technique"),
    lotl: targets.filter((t) => t.kind === "lotl"),
  }), [targets]);

  const canPublish = !!val?.ok && !busy;

  return (
    <div className="space-y-4 min-w-0 w-full">
      {/* Procedure */}
      <div className="rounded-xl border border-info/30 bg-info/5 p-3 break-words">
        <div className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5 text-info" /> Procedure — add a newly discovered technique to a library</div>
        <ol className="text-[11px] text-muted-foreground grid md:grid-cols-4 gap-x-4 gap-y-1 list-decimal ml-4">
          <li><b className="text-foreground">Pick the library</b> it belongs to (e.g. Shellcode Injection).</li>
          <li><b className="text-foreground">Fill the YAML</b> — ATT&amp;CK id, behaviour, detection queries, mitigations, references; <i>link</i> existing atomic tests.</li>
          <li><b className="text-foreground">Validate</b> — structure, library and linked tests are checked live.</li>
          <li><b className="text-foreground">Publish</b> — it appears in that library immediately (list, cards, Campaign Designer, coverage).</li>
        </ol>
        <p className="mt-1.5 text-[10px] text-muted-foreground/80">Full guide — field reference, worked examples, update/push workflow, permissions: <span className="font-mono text-foreground/80">docs/simulation/updating-libraries.md</span> · validate the docs with <span className="font-mono text-foreground/80">npm run docs:check-entries</span>.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
        {/* Editor */}
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-muted-foreground">Target library</label>
            <select value={library} onChange={(e) => { setLibrary(e.target.value); setMsg(null); }}
              className="h-9 w-full sm:w-auto sm:min-w-[240px] max-w-full px-2 text-xs rounded-md border border-border bg-input text-foreground truncate">
              <optgroup label="Attack-simulation libraries (technique entry)">
                {grouped.technique.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.techniqueCount} techniques{t.entryCount ? ` · ${t.entryCount} analyst-added` : ""}</option>)}
              </optgroup>
              <optgroup label="Living-off-the-Land libraries (lotl entry — admin approval)">
                {grouped.lotl.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.techniqueCount}{t.entryCount ? ` · ${t.entryCount} analyst-added` : ""}</option>)}
              </optgroup>
            </select>
            <button onClick={() => loadTemplate(true)} className="h-9 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"><FilePlus2 className="h-3.5 w-3.5" /> New from template</button>
            <a href={`/api/library-entries/template?kind=${target?.kind || "technique"}&library=${encodeURIComponent(library)}`} download className="h-9 px-3 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Template</a>
          </div>
          {target && (
            <div className="space-y-0.5 min-w-0">
              <p className="text-[11px] text-muted-foreground break-words [overflow-wrap:anywhere] line-clamp-2" title={target.description}>{target.description}</p>
              {target.groups.length > 0 && (
                <p className="text-[11px] text-muted-foreground break-words [overflow-wrap:anywhere] line-clamp-2" title={target.groups.map((g) => `${g.name}: ${g.domains.join(", ") || "—"}`).join("\n")}>
                  <span className="text-foreground/70">Existing groups:</span> {target.groups.map((g) => g.name + (g.domains.length ? ` (${g.domains.slice(0, 3).join(", ")}${g.domains.length > 3 ? "…" : ""})` : "")).join(" · ")}
                </p>
              )}
            </div>
          )}
          <div className="rounded-xl border border-border bg-card overflow-hidden min-w-0 max-w-full">
            <div className="px-3 py-2 border-b border-border text-[11px] font-mono text-muted-foreground flex items-center justify-between">
              <span>library-entry.yaml</span>
              {validating && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> validating…</span>}
            </div>
            <CodeMirror value={text} height="520px" width="100%" theme="dark" extensions={[yamlLang(), EditorView.lineWrapping]} onChange={(v) => { setText(v); setDirty(true); }} />
          </div>
        </div>

        {/* Validation + actions */}
        <div className="space-y-3 min-w-0 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className={cn("rounded-xl border p-4 min-w-0 break-words [overflow-wrap:anywhere]", val?.ok ? "border-success/30 bg-success/[0.04]" : val ? "border-danger/30 bg-danger/[0.04]" : "border-border bg-card")}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {val?.ok ? <><CheckCircle2 className="h-4 w-4 text-success" /> <span className="text-success">Valid · {val.exists ? `updates to v${val.nextVersion}` : "new entry"}</span></>
                : val ? <><XCircle className="h-4 w-4 text-danger" /> <span className="text-danger">{val.errors.length} error(s)</span></>
                : <span className="text-muted-foreground">Edit to validate…</span>}
            </div>
            {val?.target && <div className="mt-1 text-[11px] text-muted-foreground">Target: <span className="text-foreground">{val.target.name}</span> · key <span className="font-mono">{val.key}</span></div>}
            {val?.errors?.length ? <div className="mt-2 space-y-1">{val.errors.map((e, i) => <div key={i} className="text-[11px] text-danger flex items-start gap-1.5"><XCircle className="h-3 w-3 mt-0.5 shrink-0" /> {e}</div>)}</div> : null}
            {val?.warnings?.length ? <div className="mt-2 space-y-1">{val.warnings.map((w, i) => <div key={i} className="text-[11px] text-warning flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {w}</div>)}</div> : null}
          </div>

          {val?.resolved && val.resolved.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-3 min-w-0 break-words [overflow-wrap:anywhere]">
              <div className="text-[11px] font-semibold text-foreground mb-1">Linked atomic tests (resolved against the local library)</div>
              {val.resolved.map((r, i) => (
                <div key={i} className="text-[11px] mb-1.5">
                  <span className="font-mono text-accent">{r.technique}</span> <span className="text-muted-foreground">{r.name_includes.length ? `[${r.name_includes.join(", ")}]` : "[all tests]"} →</span> <b className={r.matched.length ? "text-success" : "text-danger"}>{r.matched.length} test(s)</b>
                  <div className="text-muted-foreground/80 pl-3">{r.matched.slice(0, 5).map((m) => `#${m.testNumber} ${m.testName}`).join(" · ")}{r.matched.length > 5 ? ` · +${r.matched.length - 5} more` : ""}</div>
                </div>
              ))}
            </div>
          )}
          {val?.preview && val.preview.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-3 text-[11px] min-w-0 break-words [overflow-wrap:anywhere]">
              <div className="font-semibold text-foreground mb-1">Will appear in the library list as</div>
              {val.preview.map((p) => <div key={p.uid} className="text-muted-foreground"><span className="font-mono text-accent">{p.id}</span> · {p.name} · {p.match && p.match.length === 0 ? "coverage-only" : p.match ? `${p.match.join(" / ")}` : "all tests"}</div>)}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => save(false)} disabled={!!busy || !text.trim()} className="h-10 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-card-hover disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
              {busy === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft
            </button>
            <button onClick={() => save(true)} disabled={!canPublish} className="h-10 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-[#60a5fa] disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
              {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : val?.willBePending ? <ShieldCheck className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />}
              {val?.willBePending ? "Submit for approval" : "Publish to library"}
            </button>
          </div>
          {msg && <div className={cn("rounded-lg border px-3 py-2 text-[11px] break-words [overflow-wrap:anywhere]", msg.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger")}>{msg.text}</div>}
        </div>
      </div>

      {/* Entries in this library */}
      <div className="rounded-xl border border-border bg-card">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <div className="text-xs font-semibold text-foreground">Analyst-added entries in {target?.name || "this library"} <span className="text-muted-foreground font-normal">({entries.length})</span></div>
          <a href={`/api/library-entries/export?library=${encodeURIComponent(library)}&drafts=1`} download className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><Download className="h-3 w-3" /> Export YAML bundle</a>
        </div>
        {entries.length === 0 ? <div className="px-4 py-5 text-[11px] text-muted-foreground">No analyst-added entries yet — publish one above and it will be listed here.</div> : (
          <div className="divide-y divide-border/60">
            {entries.map((e) => (
              <div key={e.id} className="px-4 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] min-w-0">
                <span className={cn("px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide", STATUS_STYLE[e.status] || STATUS_STYLE.draft)}>{e.status}</span>
                <span className="font-mono text-accent shrink-0">{e.attackId || "—"}</span>
                <span className="flex-1 min-w-[10rem] truncate text-foreground">{e.name} <span className="text-muted-foreground">· {e.entryKey} · v{e.version}</span></span>
                <button onClick={() => edit(e)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /> Edit</button>
                {e.status !== "published" && <button onClick={() => act(e.id, "published")} disabled={busy === e.id} className="inline-flex items-center gap-1 text-success hover:underline"><Rocket className="h-3 w-3" /> {e.status === "pending" ? "Approve" : "Publish"}</button>}
                {e.status === "published" && <button onClick={() => act(e.id, "retired")} disabled={busy === e.id} className="inline-flex items-center gap-1 text-muted-foreground hover:text-warning"><Archive className="h-3 w-3" /> Retire</button>}
                {e.status === "retired" && <button onClick={() => act(e.id, "draft")} disabled={busy === e.id} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><RotateCcw className="h-3 w-3" /> Restore</button>}
                <button onClick={() => del(e)} disabled={busy === e.id} className="inline-flex items-center gap-1 text-muted-foreground hover:text-danger"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bulk import */}
      <details className="rounded-xl border border-border bg-card">
        <summary className="px-4 py-2.5 text-xs font-semibold text-foreground cursor-pointer inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Bulk import / push updates to libraries</summary>
        <div className="px-4 pb-4 space-y-2">
          <p className="text-[11px] text-muted-foreground">Paste (or upload) a bundle exported from another instance, or a YAML list of entries — each entry names its own target library. Every entry is validated independently; valid ones are applied, invalid ones are reported and skipped.</p>
          <input type="file" accept=".yaml,.yml,.json" onChange={(e) => onFile(e.target.files?.[0])} className="text-[11px] text-muted-foreground" />
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={7} placeholder={"bundle: detectops-library-entries\nentries:\n  - kind: technique\n    library: detectops.ad-attack\n    ..."} className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-[11px] font-mono text-foreground" />
          <div className="flex gap-2">
            <button onClick={() => doImport(true)} disabled={!importText.trim() || busy === "import"} className="h-8 px-3 text-xs rounded-md border border-border text-foreground hover:bg-card-hover disabled:opacity-50">Dry run</button>
            <button onClick={() => doImport(false)} disabled={!importText.trim() || busy === "import"} className="h-8 px-3 text-xs rounded-md bg-accent text-white disabled:opacity-50 inline-flex items-center gap-1.5">{busy === "import" && <Loader2 className="h-3 w-3 animate-spin" />} Apply</button>
          </div>
          {importRes && (
            <div className="rounded-md border border-border bg-background/40 p-2 text-[11px] space-y-0.5 max-h-48 overflow-y-auto">
              <div className="text-foreground">{importRes.ok ? `${importRes.dryRun ? "Dry run" : "Applied"}: ${importRes.applied ?? importRes.results?.filter((r: any) => r.result.startsWith("would")).length}/${importRes.total}` : (importRes.errors || []).join(" · ")}</div>
              {(importRes.results || []).map((r: any, i: number) => (
                <div key={i} className={cn(r.result === "invalid" ? "text-danger" : "text-muted-foreground")}>{r.result} · {r.library} / {r.key || r.name}{r.errors ? ` — ${r.errors[0]}` : ""}</div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
