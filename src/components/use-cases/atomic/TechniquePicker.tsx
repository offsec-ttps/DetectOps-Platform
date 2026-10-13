"use client";
/**
 * Searchable MITRE technique picker (replaces the plain text input).
 *
 * The closed trigger stays a MUI TextField so it matches the rest of the MUI
 * builder form. The OPEN picker is a lightweight Tailwind overlay using the app's
 * own dark tokens — not a MUI Dialog — so it:
 *   - matches the DetectOps theme exactly (no MUI design / emotion-flash mismatch), and
 *   - stays fast while typing: the old dialog rendered ~250 result rows each with
 *     MUI <Button> tactic chips (hundreds of MUI components re-rendering per
 *     keystroke → input lag). Here rows are plain elements and filtering runs
 *     through useDeferredValue so typing never blocks.
 *
 * Emits BOTH `id` and `name` so the parent can fill `display_name` from a single
 * click. Falls back to a free-text input when the upstream CSV index is down.
 */

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { TextField, InputAdornment, CircularProgress } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Search as SearchIcon, X as CloseIcon, ExternalLink } from "lucide-react";
import useAtomicIndex, { type AtomicIndexTechnique } from "./useAtomicIndex";

const TACTICS = [
  "reconnaissance", "resource-development", "initial-access",
  "execution", "persistence", "privilege-escalation",
  "defense-evasion", "credential-access", "discovery",
  "lateral-movement", "collection", "command-and-control",
  "exfiltration", "impact",
] as const;

const TACTIC_FG: Record<string, string> = {
  "reconnaissance":         "#9AA3AE",
  "resource-development":   "#9AA3AE",
  "initial-access":         "#6FA9FF",
  "execution":              "#FF8A66",
  "persistence":            "#C28FFF",
  "privilege-escalation":   "#FFB347",
  "defense-evasion":        "#4DDD96",
  "credential-access":      "#F45C7B",
  "discovery":              "#50D5E0",
  "lateral-movement":       "#B4D85A",
  "collection":             "#F5B74E",
  "command-and-control":    "#A6B3C2",
  "exfiltration":           "#FF8AB0",
  "impact":                 "#F76C6C",
};

function tacticLabel(t: string) {
  return t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function attackUrl(tid: string) {
  return `https://attack.mitre.org/techniques/${tid.replace(".", "/")}/`;
}

interface Props {
  value: string;                                              // current technique id, e.g. T1003.001
  displayName?: string;                                       // for header chip
  /** Called with id+name when a technique is selected from the dialog. */
  onPick: (id: string, name: string) => void;
  /** Called when the user types directly in the fallback text input. */
  onTextChange?: (value: string) => void;
  /**
   * Optional gate fired BEFORE the picker dialog opens. Return true to
   * proceed, false to cancel. Used by the builder to confirm when the
   * form has unsaved edits.
   */
  confirmBeforeOpen?: () => boolean | Promise<boolean>;
  required?: boolean;
  error?: boolean;
  helperText?: string;
}

export default function TechniquePicker({
  value, displayName, onPick, onTextChange, confirmBeforeOpen, required, error, helperText,
}: Props) {
  const { data, loading, error: indexError } = useAtomicIndex();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeTactic, setActiveTactic] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Non-blocking filtering: typing updates `query` immediately (responsive
  // input) while the (heavier) list filter runs against the deferred value.
  const deferredQuery = useDeferredValue(query);

  // TID → Set<tactic>
  const tacticByTid = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!data?.tests) return m;
    for (const t of data.tests) {
      if (!t.tid || !t.tactic) continue;
      if (!m.has(t.tid)) m.set(t.tid, new Set());
      m.get(t.tid)!.add(t.tactic);
    }
    return m;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.techniques) return [];
    let list = data.techniques;
    if (activeTactic) {
      list = list.filter((t) => tacticByTid.get(t.id)?.has(activeTactic));
    }
    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
      );
    }
    return list.slice(0, 300);
  }, [data, deferredQuery, activeTactic, tacticByTid]);

  const pick = (t: AtomicIndexTechnique) => {
    onPick(t.id, t.name);
    setOpen(false);
    setQuery("");
    setActiveTactic(null);
  };

  // Click-or-keydown opens the picker (when CSV index is healthy).
  const openIfAvailable = async () => {
    if (loading || indexError) return;
    if (confirmBeforeOpen) {
      const ok = await confirmBeforeOpen();
      if (!ok) return;
    }
    setOpen(true);
  };

  // Focus the search on open; close on Escape.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open]);

  // Display shown in the closed input: "T1003.001 · OS Credential Dumping: LSASS Memory"
  const closedLabel = value
    ? (displayName ? `${value} · ${displayName}` : value)
    : "";

  return (
    <>
      <TextField
        label="ATT&CK Technique"
        required={required}
        value={closedLabel}
        onChange={(e) => onTextChange?.(e.target.value)}
        onClick={openIfAvailable}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIfAvailable(); } }}
        error={error}
        helperText={helperText || (indexError ? "Index unavailable — type a technique manually." : undefined)}
        fullWidth
        size="small"
        InputProps={{
          readOnly: !indexError,
          sx: { cursor: indexError ? "text" : "pointer" },
          endAdornment: loading
            ? <InputAdornment position="end"><CircularProgress size={14} /></InputAdornment>
            : <InputAdornment position="end"><KeyboardArrowDownIcon fontSize="small" /></InputAdornment>,
        }}
        placeholder="Choose a technique…"
      />

      {open && (
        <div className="fixed inset-0 z-[1400] flex items-start justify-center p-4" role="dialog" aria-modal="true" aria-label="Pick MITRE ATT&CK technique">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
          <div className="relative z-10 mt-[6vh] flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            {/* header */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h2 className="flex-1 text-sm font-semibold text-foreground">Pick MITRE ATT&CK technique</h2>
              {value && (
                <a href={attackUrl(value)} target="_blank" rel="noreferrer" title="Open on attack.mitre.org"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-card-hover">
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              <button onClick={() => setOpen(false)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-card-hover">
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2.5 p-4 pb-2">
              {/* search */}
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by technique id or name…"
                  className="h-9 w-full rounded-md border border-border bg-input pl-8 pr-3 text-xs text-foreground outline-none focus:border-accent/60"
                />
              </div>

              {/* tactic filter chips */}
              <div className="flex flex-wrap gap-1.5">
                <TacticChip tactic="all" label="All" active={activeTactic === null} onClick={() => setActiveTactic(null)} />
                {TACTICS.map((t) => (
                  <TacticChip key={t} tactic={t} label={tacticLabel(t)} active={activeTactic === t}
                    onClick={() => setActiveTactic(activeTactic === t ? null : t)} />
                ))}
              </div>
            </div>

            {/* results */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {loading && (
                <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
                  <CircularProgress size={16} /> Loading atomic-red-team index…
                </div>
              )}
              {indexError && (
                <div className="px-1 py-4">
                  <p className="text-sm text-warning">{indexError.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">You can still type a technique id manually in the field.</p>
                </div>
              )}
              {!loading && !indexError && (
                filtered.length === 0 ? (
                  <div className="py-10 text-center text-[13px] text-muted-foreground">No techniques match this search / tactic.</div>
                ) : (
                  <div className="space-y-0.5">
                    {filtered.map((t) => {
                      const tactics = [...(tacticByTid.get(t.id) || [])];
                      const selected = t.id === value;
                      return (
                        <button
                          key={t.id}
                          onClick={() => pick(t)}
                          className={
                            "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors " +
                            (selected ? "border-accent/40 bg-accent/10" : "border-transparent hover:bg-[rgba(255,255,255,0.04)]")
                          }
                        >
                          <span className="w-[72px] shrink-0 font-mono text-[12px] text-accent">{t.id}</span>
                          <span className="flex-1 text-[13px] text-foreground">{t.name}</span>
                          <span className="flex flex-wrap justify-end gap-1">
                            {tactics.map((tac) => <TacticBadge key={tac} tactic={tac} label={tacticLabel(tac)} />)}
                          </span>
                        </button>
                      );
                    })}
                    {data?.techniques && filtered.length >= 300 && (
                      <div className="px-1 py-2 text-center text-[11px] text-muted-foreground">Showing first 300 — refine your search to narrow down.</div>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// A clickable tactic filter chip (top row).
function TacticChip({ tactic, label, onClick, active }: { tactic: string; label: string; onClick?: () => void; active?: boolean }) {
  const fg = tactic === "all" ? "#94a3b8" : TACTIC_FG[tactic] || "#94a3b8";
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors"
      style={{
        color: active ? "#60a5fa" : fg,
        borderColor: active ? "#3b82f6" : `${fg}55`,
        background: active ? "rgba(59,130,246,0.12)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

// A tiny, non-interactive tactic badge shown on a result row.
function TacticBadge({ tactic, label }: { tactic: string; label: string }) {
  const fg = TACTIC_FG[tactic] || "#94a3b8";
  return (
    <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium" style={{ color: fg, borderColor: `${fg}40` }}>
      {label}
    </span>
  );
}
