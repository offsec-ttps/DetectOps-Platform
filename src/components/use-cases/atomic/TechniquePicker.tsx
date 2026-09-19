"use client";
/**
 * Searchable MITRE technique picker (replaces the plain text input).
 *
 * Opens a dialog with:
 *   - tactic chip row across the top (filters)
 *   - search box
 *   - virtualised result list (technique id + name)
 *
 * Emits BOTH `id` and `name` so the parent can fill `display_name` from a
 * single click. Falls back to a free-text input when the upstream CSV
 * index can't be reached.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, IconButton, InputAdornment,
  TextField, Typography, CircularProgress, Stack, FormHelperText,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
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
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
      );
    }
    return list.slice(0, 250);
  }, [data, query, activeTactic, tacticByTid]);

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

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: "#111827", minHeight: 480 } }}>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
          <Box sx={{ flex: 1 }}>Pick MITRE ATT&CK technique</Box>
          {value && (
            <IconButton size="small" component="a" href={attackUrl(value)} target="_blank" rel="noreferrer">
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton size="small" onClick={() => setOpen(false)}><CloseIcon fontSize="small" /></IconButton>
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small"
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by technique id or name…"
            sx={{ mb: 1.5 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />

          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5, gap: 0.5 }}>
            <TacticChip
              tactic={"all"}
              active={activeTactic === null}
              onClick={() => setActiveTactic(null)}
              label="All"
            />
            {TACTICS.map((t) => (
              <TacticChip
                key={t} tactic={t}
                active={activeTactic === t}
                onClick={() => setActiveTactic(activeTactic === t ? null : t)}
                label={tacticLabel(t)}
              />
            ))}
          </Stack>

          {loading && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 3 }}>
              <CircularProgress size={16} /> Loading atomic-red-team index…
            </Box>
          )}
          {indexError && (
            <Box sx={{ py: 2 }}>
              <Typography variant="body2" color="warning.main">{indexError.message}</Typography>
              <FormHelperText>You can still type a technique id manually in the field.</FormHelperText>
            </Box>
          )}

          {!loading && !indexError && (
            <Box sx={{ maxHeight: 360, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <Box sx={{ py: 4, textAlign: "center", color: "text.disabled", fontSize: 13 }}>
                  No techniques match this search / tactic.
                </Box>
              ) : (
                filtered.map((t) => {
                  const tactics = [...(tacticByTid.get(t.id) || [])];
                  const selected = t.id === value;
                  return (
                    <Box
                      key={t.id}
                      onClick={() => pick(t)}
                      sx={{
                        px: 1.5, py: 1, borderRadius: 1, cursor: "pointer",
                        background: selected ? "rgba(59,130,246,0.10)" : "transparent",
                        border: "1px solid",
                        borderColor: selected ? "rgba(59,130,246,0.40)" : "transparent",
                        mb: 0.5,
                        "&:hover": { background: "rgba(255,255,255,0.04)" },
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ gap: 0.5 }}>
                        <Box sx={{ fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 12, color: "primary.main", minWidth: 80 }}>
                          {t.id}
                        </Box>
                        <Box sx={{ flex: 1, fontSize: 13, color: "text.primary" }}>{t.name}</Box>
                        {tactics.map((tac) => (
                          <TacticChip key={tac} tactic={tac} label={tacticLabel(tac)} size="xs" />
                        ))}
                      </Stack>
                    </Box>
                  );
                })
              )}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TacticChip({ tactic, label, onClick, active, size = "sm" }: {
  tactic: string; label: string; onClick?: () => void; active?: boolean; size?: "xs" | "sm";
}) {
  const fg = tactic === "all" ? "#94a3b8" : TACTIC_FG[tactic] || "#94a3b8";
  return (
    <Button
      onClick={onClick}
      variant={active ? "contained" : "outlined"}
      size="small"
      disableRipple={!onClick}
      sx={{
        textTransform: "none",
        px: size === "xs" ? 0.9 : 1.2,
        py: size === "xs" ? 0.05 : 0.25,
        minHeight: 0, minWidth: 0,
        fontSize: size === "xs" ? 10 : 11,
        fontWeight: 500,
        borderRadius: 999,
        borderColor: active ? "primary.main" : `${fg}55`,
        color: active ? "primary.main" : fg,
        background: active ? "rgba(59,130,246,0.10)" : "transparent",
        "&:hover": { background: active ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)" },
      }}
    >
      {label}
    </Button>
  );
}
