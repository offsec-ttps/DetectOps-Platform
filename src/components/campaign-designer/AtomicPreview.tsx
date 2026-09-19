"use client";

/**
 * Per-technique atomic preview + editor for the Campaign Designer.
 *
 * Shows exactly what will run on the endpoint for a selected MITRE technique —
 * the Atomic Red Team test(s): executor, command, cleanup, input args — in a
 * collapsible panel. The user can view read-only, or Edit and **Save as a new
 * atomic** (a custom copy under a new name; the upstream default is never
 * changed). Picking a test number tells the run which atomic to execute
 * (honored by the fleet path via testIndex).
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, Save, X, ShieldAlert, Check, FileCode2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface AtomicTest {
  id: string; techniqueId: string; techniqueName?: string; testNumber: number; testName: string;
  testDescription?: string; executorName: string; command: string; cleanupCommand: string;
  elevationRequired: boolean; platforms: string[]; inputArguments: Record<string, { description?: string; type?: string; default?: string }>;
  source: string;
}

export default function AtomicPreview({ techniqueId, selectedTest, onSelectTest }: {
  techniqueId: string; selectedTest?: number; onSelectTest?: (testNumber: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tests, setTests] = useState<AtomicTest[] | null>(null);
  const [active, setActive] = useState<number>(selectedTest || 1);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // editable fields
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [cleanup, setCleanup] = useState("");

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const r = await fetch(`/api/atomic-tests?technique_id=${encodeURIComponent(techniqueId)}&page_size=50&sort_by=testNumber&sort_dir=asc`);
      const d = await r.json();
      const items: AtomicTest[] = (d.items || []).filter((t: AtomicTest) => t.techniqueId.toUpperCase() === techniqueId.toUpperCase());
      items.sort((a, b) => a.testNumber - b.testNumber);
      setTests(items);
      if (items.length && !items.some((t) => t.testNumber === active)) setActive(items[0].testNumber);
    } catch { setTests([]); }
  }, [techniqueId, active]);

  useEffect(() => { if (open && tests === null) void load(); /* eslint-disable-next-line */ }, [open]);

  const cur = tests?.find((t) => t.testNumber === active) || null;

  // Sync editable fields when the active test changes / edit begins.
  useEffect(() => {
    if (cur && !editing) { setName(`${cur.testName} (custom)`); setCommand(cur.command); setCleanup(cur.cleanupCommand); }
    // eslint-disable-next-line
  }, [active, tests]);

  const beginEdit = () => { if (cur) { setName(`${cur.testName} (custom)`); setCommand(cur.command); setCleanup(cur.cleanupCommand); setEditing(true); setMsg(null); } };

  const saveAsNew = async () => {
    if (!cur) return;
    if (!name.trim() || !command.trim()) { setMsg({ ok: false, text: "Name and command are required." }); return; }
    setSaving(true); setMsg(null);
    try {
      const input_arguments = Object.entries(cur.inputArguments || {}).map(([k, v]) => ({
        name: k, description: v?.description || "", type: v?.type || "string", default: v?.default ?? "",
      }));
      const r = await fetch("/api/atomic-tests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attack_technique: techniqueId,
          display_name: cur.techniqueName || techniqueId,
          name: name.trim(),
          description: cur.testDescription || `Custom copy of "${cur.testName}"`,
          supported_platforms: cur.platforms?.length ? cur.platforms : ["windows"],
          executor: { name: cur.executorName || "command_prompt", command, cleanup_command: cleanup, elevation_required: cur.elevationRequired },
          input_arguments,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: d.error || "save failed" }); return; }
      setEditing(false);
      await load();
      const newNum = d.testNumber ?? d.test?.testNumber;
      if (newNum) { setActive(newNum); onSelectTest?.(newNum); }
      setMsg({ ok: true, text: `Saved as a new custom atomic (test #${newNum ?? "?"}) — selected to run.` });
    } catch (e: any) { setMsg({ ok: false, text: e?.message || String(e) }); } finally { setSaving(false); }
  };

  const pick = (n: number) => { setActive(n); setEditing(false); onSelectTest?.(n); };
  const copyCmd = () => { if (cur) navigator.clipboard?.writeText(cur.command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };

  return (
    <div className="rounded-lg border border-border bg-background/40">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2 flex items-center gap-2 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <FileCode2 className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-mono font-bold text-accent">{techniqueId}</span>
        <span className="text-[11px] text-muted-foreground">— what will run on the endpoint {tests ? `(${tests.length} test${tests.length !== 1 ? "s" : ""})` : ""}</span>
        {selectedTest && selectedTest !== 1 && <span className="ml-auto text-[10px] text-purple">running test #{selectedTest}</span>}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-border pt-2 space-y-2">
          {tests === null ? (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading atomic content…</div>
          ) : tests.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">No Atomic Red Team test found for {techniqueId} in the library. On fleet/SAR it will attempt test #1; you can author one in the Custom Simulation Builder.</div>
          ) : (
            <>
              {/* Test selector */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Test:</span>
                {tests.map((t) => (
                  <button key={t.testNumber} onClick={() => pick(t.testNumber)}
                    className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border",
                      active === t.testNumber ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-card-hover")}>
                    #{t.testNumber}{t.source === "custom" ? " · custom" : ""}
                  </button>
                ))}
              </div>

              {cur && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-foreground">{cur.testName}</span>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted/15 text-muted-foreground">{cur.executorName || "?"}</span>
                    {cur.elevationRequired && <span className="text-[10px] inline-flex items-center gap-1 text-warning"><ShieldAlert className="h-3 w-3" /> needs admin</span>}
                    {cur.source === "custom" && <span className="text-[10px] text-purple">custom</span>}
                    {cur.platforms?.length ? <span className="text-[10px] text-muted-foreground">{cur.platforms.join(", ")}</span> : null}
                  </div>
                  {cur.testDescription && !editing && <p className="text-[11px] text-muted-foreground">{cur.testDescription}</p>}

                  {!editing ? (
                    <>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2"><span className="text-[10px] font-semibold text-muted-foreground uppercase">Command</span>
                          <button onClick={copyCmd} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">{copied ? <><Check className="h-3 w-3 text-success" /> copied</> : <><Copy className="h-3 w-3" /> copy</>}</button>
                        </div>
                        <pre className="text-[10px] font-mono bg-background/70 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-foreground max-h-48 overflow-y-auto">{cur.command || "(no command)"}</pre>
                      </div>
                      {cur.cleanupCommand && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Cleanup</span>
                          <pre className="text-[10px] font-mono bg-background/70 border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground max-h-32 overflow-y-auto">{cur.cleanupCommand}</pre>
                        </div>
                      )}
                      {Object.keys(cur.inputArguments || {}).length > 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          <span className="font-semibold uppercase">Input args:</span> {Object.entries(cur.inputArguments).map(([k, v]) => `${k}=${v?.default ?? ""}`).join(" · ")}
                        </div>
                      )}
                      <button onClick={beginEdit} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover"><Pencil className="h-3 w-3" /> Edit &amp; save as new</button>
                    </>
                  ) : (
                    <div className="space-y-2 rounded-md border border-purple/30 bg-purple/5 p-2">
                      <p className="text-[10px] text-muted-foreground">Editing creates a <span className="text-foreground font-medium">new custom atomic</span> — the original ({techniqueId} #{cur.testNumber}) stays untouched.</p>
                      <label className="block text-[10px] text-muted-foreground">New atomic name
                        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full px-2 py-1 text-[11px] rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                      </label>
                      <label className="block text-[10px] text-muted-foreground">Command
                        <textarea value={command} onChange={(e) => setCommand(e.target.value)} rows={5} className="mt-1 w-full px-2 py-1 text-[10px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                      </label>
                      <label className="block text-[10px] text-muted-foreground">Cleanup
                        <textarea value={cleanup} onChange={(e) => setCleanup(e.target.value)} rows={3} className="mt-1 w-full px-2 py-1 text-[10px] font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
                      </label>
                      <div className="flex items-center gap-2">
                        <button onClick={saveAsNew} disabled={saving} className="inline-flex items-center gap-1.5 text-[11px] h-7 px-2.5 rounded bg-purple text-white hover:bg-purple/90 disabled:opacity-50">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save as new atomic</button>
                        <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground"><X className="h-3 w-3" /> Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {msg && <div className={cn("text-[10px] flex items-start gap-1", msg.ok ? "text-success" : "text-danger")}>{msg.ok ? <Check className="h-3 w-3 mt-0.5" /> : null}{msg.text}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
