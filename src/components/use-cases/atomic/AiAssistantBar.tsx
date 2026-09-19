"use client";
/**
 * Top input bar that does two things at once:
 *   1. Fuzzy-searches the upstream atomic-red-team index → top suggestions
 *      that load directly into the form (no LLM cost).
 *   2. Triggers the LLM "generate ART test from prompt" flow when the user
 *      clicks Generate. Falls back gracefully when ANTHROPIC_API_KEY is
 *      missing — the suggestion path still works in that case.
 *
 * Layout: a `position: relative` wrapper around ONLY the input row so the
 * suggestions dropdown anchors to the input, not to the surrounding alerts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, IconButton, InputAdornment, Paper, TextField, Button,
  CircularProgress, Tooltip, Stack, Typography, ClickAwayListener,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import TuneIcon from "@mui/icons-material/Tune";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import * as yaml from "js-yaml";
import Fuse from "fuse.js";
import useAtomicIndex, { techniqueYamlUrl, type AtomicIndexTest } from "./useAtomicIndex";
import { splitUpstreamYaml, mergeUpstreamTestIntoForm } from "./yaml-merge";
import type { AtomicYamlInput } from "@/lib/use-cases/types";

const MAX_SUGGESTIONS = 6;
const DEBOUNCE_MS = 150;
const MIN_QUERY = 2;

interface Props {
  onLoad: (input: AtomicYamlInput) => void;
  onAiResult?: (input: { yaml: AtomicYamlInput; meta: { model: string; inputTokens: number; outputTokens: number; costUsd: number; expectedSignal: string } }) => void;
  aiConfigured: boolean | null;
}

export default function AiAssistantBar({ onLoad, onAiResult, aiConfigured }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [running, setRunning] = useState(false);
  const [loadingTest, setLoadingTest] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const { data, loading: indexLoading, error: indexError } = useAtomicIndex();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const fuse = useMemo(() => {
    if (!data?.tests) return null;
    return new Fuse(data.tests, {
      keys: [
        { name: "testName", weight: 0.5 },
        { name: "techName", weight: 0.3 },
        { name: "tid",      weight: 0.1 },
        { name: "tactic",   weight: 0.05 },
        { name: "exec",     weight: 0.05 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
  }, [data]);

  const suggestions: AtomicIndexTest[] = useMemo(() => {
    if (!fuse || debounced.length < MIN_QUERY) return [];
    return fuse.search(debounced, { limit: MAX_SUGGESTIONS }).map((r) => r.item);
  }, [fuse, debounced]);

  // Dropdown visible whenever the input is focused AND the user has typed
  // at least MIN_QUERY characters. We render different states (loading
  // index / index error / no matches / matches) instead of hiding the
  // panel entirely, so the user always sees feedback.
  const showPanel = focused && debounced.length >= MIN_QUERY;

  const loadSuggestion = async (it: AtomicIndexTest) => {
    setLoadingTest(it.guid || `${it.tid}-${it.testNum}`); setAiError(null);
    try {
      const r = await fetch(techniqueYamlUrl(it.tid));
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${it.tid}.yaml`);
      const text = await r.text();
      const parsed = yaml.load(text);
      const split = splitUpstreamYaml(parsed);
      let entry = split.tests.find((t) => t.raw?.auto_generated_guid === it.guid);
      if (!entry && it.testNum) entry = split.tests[parseInt(it.testNum, 10) - 1];
      if (!entry) entry = split.tests.find((t) => t.name === it.testName);
      if (!entry) entry = split.tests[0];
      if (!entry) throw new Error("Test not found in upstream YAML");
      const merged = mergeUpstreamTestIntoForm(entry.raw, split.techniqueId || it.tid, split.displayName || it.techName);
      onLoad(merged);
      setQuery("");
      inputRef.current?.blur();
    } catch (err: any) {
      setAiError(err?.message || "Failed to load suggestion");
    } finally { setLoadingTest(null); }
  };

  const generate = async () => {
    if (!query.trim() || !aiConfigured) return;
    setRunning(true); setAiError(null);
    try {
      const res = await fetch("/api/use-cases/ai/atomic-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setAiError(data.error || "Generation failed"); return; }
      onLoad(data.yaml);
      onAiResult?.({
        yaml: data.yaml,
        meta: {
          model: data.model, inputTokens: data.inputTokens, outputTokens: data.outputTokens,
          costUsd: data.costUsd, expectedSignal: data.expectedSignal || "",
        },
      });
      setQuery("");
      inputRef.current?.blur();
    } catch (err: any) {
      setAiError(err?.message || "Generation failed");
    } finally { setRunning(false); }
  };

  return (
    <Box>
      {/* Wrapper that ONLY contains the input + dropdown — alerts live outside it
          so the dropdown's absolute positioning anchors to the bar itself. */}
      <ClickAwayListener onClickAway={() => setFocused(false)}>
        <Box sx={{ position: "relative" }}>
          <Paper variant="outlined" sx={{
            display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.5,
            borderRadius: 999,
            background: "linear-gradient(90deg, rgba(59,130,246,0.04), rgba(168,85,247,0.04))",
            borderColor: focused ? "primary.main" : "rgba(59,130,246,0.25)",
            transition: "border-color 120ms",
          }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, #3b82f6, #a855f7)",
              color: "white",
            }}>
              <AutoAwesomeIcon fontSize="small" />
            </Box>
            <TextField
              inputRef={inputRef}
              fullWidth size="small" variant="standard"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setFocused(false); inputRef.current?.blur(); }
                if (e.key === "Enter" && !e.shiftKey) {
                  // Plain Enter loads the first suggestion if one is shown;
                  // Cmd/Ctrl+Enter always triggers Generate.
                  if (suggestions.length > 0 && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    loadSuggestion(suggestions[0]);
                  } else if ((e.metaKey || e.ctrlKey) || suggestions.length === 0) {
                    generate();
                  }
                }
              }}
              placeholder="Describe a test, paste a procedure, or pick a technique…"
              InputProps={{ disableUnderline: true, sx: { fontSize: 14 } }}
            />
            <Tooltip title="More options (coming soon)">
              <span><IconButton size="small" disabled><TuneIcon fontSize="small" /></IconButton></span>
            </Tooltip>
            <Button
              variant="contained" size="small"
              onClick={generate}
              disabled={!query.trim() || running || aiConfigured === false}
              sx={{
                textTransform: "none", borderRadius: 999, fontWeight: 600, px: 2,
                background: "linear-gradient(90deg, #f97316, #ec4899)",
                "&:hover": { background: "linear-gradient(90deg, #fb923c, #f472b6)" },
                "&.Mui-disabled": { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" },
              }}
              startIcon={running ? <CircularProgress size={12} color="inherit" /> : undefined}
            >
              {running ? "Generating…" : "Generate"}
            </Button>
          </Paper>

          {/* Dropdown anchored to the bar — visible whenever the user has
              typed >= MIN_QUERY characters AND the input is focused. */}
          {showPanel && (
            <Paper variant="outlined" sx={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
              zIndex: 1300, bgcolor: "#0e1422", py: 0.5,
              maxHeight: 360, overflowY: "auto",
              boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
            }}>
              {indexLoading && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 1.5 }}>
                  <CircularProgress size={12} />
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Loading atomic-red-team index…
                  </Typography>
                </Stack>
              )}
              {indexError && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 1.5 }}>
                  <SearchOffIcon fontSize="small" color="warning" />
                  <Typography variant="caption" sx={{ color: "warning.main" }}>
                    {indexError.message}
                  </Typography>
                </Stack>
              )}
              {!indexLoading && !indexError && suggestions.length === 0 && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 1.5 }}>
                  <SearchOffIcon fontSize="small" sx={{ color: "text.disabled" }} />
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    No upstream tests match “{debounced}”. Press <kbd style={{ background: "rgba(255,255,255,0.06)", padding: "0 4px", borderRadius: 3, fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>⌘/Ctrl + Enter</kbd> to AI-generate instead.
                  </Typography>
                </Stack>
              )}
              {!indexLoading && !indexError && suggestions.length > 0 && (
                <>
                  <Typography variant="caption" sx={{ display: "block", px: 1.5, py: 0.5, color: "text.disabled", textTransform: "uppercase", letterSpacing: 1, fontSize: 10 }}>
                    Suggestions ({suggestions.length})
                  </Typography>
                  {suggestions.map((s, i) => {
                    const key = s.guid || `${s.tid}-${s.testNum}`;
                    const busy = loadingTest === key;
                    return (
                      <Box
                        key={key}
                        onClick={() => !busy && loadSuggestion(s)}
                        sx={{
                          px: 1.5, py: 1, cursor: busy ? "default" : "pointer",
                          display: "flex", alignItems: "center", gap: 1,
                          borderTop: i === 0 ? undefined : "1px solid",
                          borderColor: "rgba(255,255,255,0.04)",
                          "&:hover": { background: "rgba(59,130,246,0.10)" },
                        }}
                      >
                        <Box sx={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "primary.main", minWidth: 80 }}>{s.tid}</Box>
                        <Box sx={{ flex: 1, fontSize: 13 }}>
                          <Box>{s.testName}</Box>
                          <Box sx={{ fontSize: 11, color: "text.secondary" }}>{s.techName}</Box>
                        </Box>
                        <Box sx={{ fontSize: 10, color: "text.disabled", textTransform: "uppercase" }}>{s.exec}</Box>
                        {busy && <CircularProgress size={12} />}
                      </Box>
                    );
                  })}
                  <Typography variant="caption" sx={{ display: "block", px: 1.5, pt: 1, pb: 0.5, color: "text.disabled", fontSize: 11 }}>
                    Press <kbd style={{ background: "rgba(255,255,255,0.06)", padding: "0 4px", borderRadius: 3, fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>Enter</kbd> to load first match, <kbd style={{ background: "rgba(255,255,255,0.06)", padding: "0 4px", borderRadius: 3, fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>⌘/Ctrl + Enter</kbd> to AI-generate.
                  </Typography>
                </>
              )}
            </Paper>
          )}
        </Box>
      </ClickAwayListener>

      {/* Alerts: live OUTSIDE the relative wrapper so they don't push the dropdown */}
      {aiConfigured === false && (
        <Typography variant="caption" sx={{ display: "block", mt: 0.5, ml: 1.5, color: "warning.main" }}>
          AI Generate disabled — set ANTHROPIC_API_KEY in .env to enable. Suggestion list still works.
        </Typography>
      )}
      {aiError && (
        <Typography variant="caption" sx={{ display: "block", mt: 0.5, ml: 1.5, color: "error.main" }}>
          {aiError}
        </Typography>
      )}
    </Box>
  );
}
