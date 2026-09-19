"use client";
/**
 * ART YAML Builder — feature-parity port of atomicgen.io (Apache-2.0).
 *
 * Layout: a sticky tab strip at the very top (browser-style multi-tab
 * authoring) + the upstream three-section form on the left and a YAML
 * preview on the right. Each tab keeps its own form state, AI status,
 * and dirty/saved flags. CodeMirror has line wrapping enabled everywhere
 * so long commands never push the viewport.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ThemeProvider, createTheme, CssBaseline,
  Box, Stack, TextField, MenuItem, Button, Chip, IconButton, Switch, FormControlLabel,
  Typography, Divider, Tooltip, Paper, Alert, CircularProgress,
  Menu, ListItemText, Accordion, AccordionSummary, AccordionDetails,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import FlagIcon from "@mui/icons-material/Flag";
import TerminalIcon from "@mui/icons-material/Terminal";
import BuildIcon from "@mui/icons-material/Build";
import RefreshIcon from "@mui/icons-material/Refresh";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import CodeIcon from "@mui/icons-material/CodeRounded";
import LocalLibraryIcon from "@mui/icons-material/LocalLibraryRounded";
import Link from "next/link";
import * as yaml from "js-yaml";
import CodeMirror from "@uiw/react-codemirror";
import { yaml as cmYaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";

import {
  baseAtomic, EXECUTOR_NAMES, INPUT_ARGUMENT_TYPES,
  validateAtomic, allOk,
} from "./schema";
import type { AtomicYamlInput } from "@/lib/use-cases/types";
import TechniquePicker from "./TechniquePicker";
import RepoLoader from "./RepoLoader";
import UploadYaml from "./UploadYaml";
import AiAssistantBar from "./AiAssistantBar";
import YamlEmptyState from "./YamlEmptyState";
import { SAMPLES } from "./samples";
import { techniqueYamlUrl } from "./useAtomicIndex";
import { splitUpstreamYaml, mergeUpstreamTestIntoForm } from "./yaml-merge";
import TabStrip, { type TabMeta } from "./TabStrip";

// ─── Theme ────────────────────────────────────────────────────────────────────
const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0a0e1a", paper: "#111827" },
    primary: { main: "#3b82f6" },
    secondary: { main: "#a855f7" },
    error: { main: "#ef4444" },
    success: { main: "#22c55e" },
    warning: { main: "#f59e0b" },
    divider: "rgba(255,255,255,0.08)",
  },
  shape: { borderRadius: 12 },
  typography: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontSize: 13 },
  components: {
    MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
    MuiButton: { styleOverrides: { root: { textTransform: "none" } } },
    MuiPaper: { defaultProps: { variant: "outlined" }, styleOverrides: { outlined: { borderColor: "rgba(255,255,255,0.08)" } } },
  },
});

// CodeMirror extension list — line wrap is added everywhere so long commands
// don't blow out the viewport.
const CM_EXTENSIONS = [cmYaml(), EditorView.lineWrapping];
const CM_CODE_EXTENSIONS = [EditorView.lineWrapping];

// ─── Per-tab state ────────────────────────────────────────────────────────────
interface PickStatus { kind: "loading" | "ok" | "miss" | "err"; message: string }
interface AiResultMeta { model: string; inputTokens: number; outputTokens: number; costUsd: number; expectedSignal: string }
interface TabState {
  id: string;
  v: AtomicYamlInput;
  pickStatus: PickStatus | null;
  aiResultMeta: AiResultMeta | null;
  dirty: boolean;
  saved: boolean;
}

function makeBlank(): TabState {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    v: { ...baseAtomic },
    pickStatus: null,
    aiResultMeta: null,
    dirty: false,
    saved: false,
  };
}

function toYaml(v: AtomicYamlInput): string {
  const test: Record<string, unknown> = {
    name: v.name || "",
    auto_generated_guid: v.auto_generated_guid || undefined,
    description: v.description || "",
    supported_platforms: v.supported_platforms.length ? v.supported_platforms : ["windows"],
  };
  if (v.input_arguments.length) {
    test.input_arguments = Object.fromEntries(
      v.input_arguments
        .filter((a) => a.name)
        .map((a) => [a.name, { description: a.description || "", type: a.type, default: a.default || "" }]),
    );
  }
  if (v.dependency_executor_name) test.dependency_executor_name = v.dependency_executor_name;
  if (v.dependencies.length) test.dependencies = v.dependencies.filter((d) => d.description || d.prereq_command);
  test.executor = {
    name: v.executor.name || "powershell",
    elevation_required: v.executor.elevation_required,
    ...(v.executor.command ? { command: v.executor.command } : {}),
    ...(v.executor.cleanup_command ? { cleanup_command: v.executor.cleanup_command } : {}),
    ...(v.executor.steps ? { steps: v.executor.steps } : {}),
  };
  return yaml.dump({
    attack_technique: v.attack_technique || "T0000",
    display_name: v.display_name || "",
    atomic_tests: [test],
  }, { lineWidth: 100, noRefs: true, quotingType: '"' });
}

function isPristine(v: AtomicYamlInput): boolean {
  return (
    !v.attack_technique && !v.display_name && !v.name && !v.description &&
    v.supported_platforms.length === 0 &&
    !v.executor.name && !v.executor.command && !v.executor.cleanup_command && !v.executor.steps &&
    v.input_arguments.length === 0 && v.dependencies.length === 0
  );
}

function tabLabel(t: TabState): string {
  const v = t.v;
  if (v.name) return v.name;
  if (v.attack_technique) return v.attack_technique;
  return "Untitled test";
}
function tabHint(t: TabState): string | undefined {
  const v = t.v;
  if (v.attack_technique && v.display_name) return `${v.attack_technique} · ${v.display_name}`;
  if (v.attack_technique) return v.attack_technique;
  return undefined;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AtomicBuilder() {
  const router = useRouter();

  // Tabs — first tab is created once with a stable id so `activeId` tracks
  // it from the first render with no flash.
  const initialTab = useRef<TabState | null>(null);
  if (initialTab.current === null) initialTab.current = makeBlank();
  const [tabs, setTabs] = useState<TabState[]>(() => [initialTab.current!]);
  const [activeId, setActiveId] = useState<string>(() => initialTab.current!.id);
  const activeIdx = useMemo(() => tabs.findIndex((t) => t.id === activeId), [tabs, activeId]);
  const active = tabs[activeIdx];

  // Global UI
  const [repoOpen, setRepoOpen] = useState(false);
  const [sampleAnchor, setSampleAnchor] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState<"current" | "all" | "library" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<React.ReactNode | null>(null);

  // AI config probe
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/use-cases/ai/generations?pageSize=1")
      .then((r) => r.json())
      .then((d) => setAiConfigured(d?.config?.anthropic === "configured"))
      .catch(() => setAiConfigured(false));
  }, []);

  // Helpers that target the active tab only
  const setActiveV = (next: AtomicYamlInput | ((prev: AtomicYamlInput) => AtomicYamlInput)) => {
    setTabs((arr) => arr.map((t) => t.id !== activeId ? t : {
      ...t,
      v: typeof next === "function" ? (next as (p: AtomicYamlInput) => AtomicYamlInput)(t.v) : next,
      dirty: true,
      saved: false,
    }));
  };
  const updateActive = <K extends keyof AtomicYamlInput>(k: K, val: AtomicYamlInput[K]) =>
    setActiveV((prev) => ({ ...prev, [k]: val }));
  const updateExecutor = (patch: Partial<AtomicYamlInput["executor"]>) =>
    setActiveV((prev) => ({ ...prev, executor: { ...prev.executor, ...patch } }));
  const setActivePickStatus = (s: PickStatus | null) =>
    setTabs((arr) => arr.map((t) => t.id !== activeId ? t : { ...t, pickStatus: s }));
  const setActiveAiMeta = (m: AiResultMeta | null) =>
    setTabs((arr) => arr.map((t) => t.id !== activeId ? t : { ...t, aiResultMeta: m }));

  const resetActive = () => {
    if (!confirm("Discard this tab's fields and start over?")) return;
    setTabs((arr) => arr.map((t) => t.id !== activeId ? t : { ...t, v: { ...baseAtomic }, pickStatus: null, aiResultMeta: null, dirty: false, saved: false }));
  };
  const loadIntoActive = (next: AtomicYamlInput) => {
    setTabs((arr) => arr.map((t) => t.id !== activeId ? t : { ...t, v: next, pickStatus: null, aiResultMeta: null, dirty: true, saved: false }));
  };

  // Tab strip handlers
  const addTab = () => {
    const t = makeBlank();
    setTabs((arr) => [...arr, t]);
    setActiveId(t.id);
  };
  const closeTab = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (t?.dirty && !confirm(`"${tabLabel(t)}" has unsaved changes. Close anyway?`)) return;
    setTabs((arr) => {
      const next = arr.filter((x) => x.id !== id);
      if (next.length === 0) {
        const fresh = makeBlank();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) {
        const idx = arr.findIndex((x) => x.id === id);
        setActiveId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  };

  const errs = useMemo(() => active ? validateAtomic(active.v) : {}, [active]);
  const canSave = active && allOk(errs);
  const yamlBody = useMemo(() => active ? toYaml(active.v) : "", [active]);
  const pristine = !active || isPristine(active.v);

  // Save a single tab; returns new UseCase id or null
  const saveTab = async (t: TabState): Promise<string | null> => {
    const e = validateAtomic(t.v);
    if (!allOk(e)) return null;
    const res = await fetch("/api/use-cases", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: t.v.name || t.v.attack_technique || "Untitled ART test",
        description: t.v.description || "",
        authorMode: "atomic", framework: "atomic", source: "manual",
        platforms: t.v.supported_platforms,
        steps: [{
          orderIndex: 0, kind: "atomic", techniqueId: t.v.attack_technique || "",
          displayName: t.v.name || t.v.attack_technique || "Untitled",
          parameters: { atomic: { yaml: t.v } },
          expectedSignal: t.aiResultMeta?.expectedSignal || "", notes: t.v.description || "",
        }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    return data.id as string;
  };

  const saveCurrent = async () => {
    if (!active || !canSave) return;
    setSaving("current"); setSaveError(null); setSavedFlash(null);
    try {
      const id = await saveTab(active);
      if (id) {
        setTabs((arr) => arr.map((x) => x.id === active.id ? { ...x, dirty: false, saved: true } : x));
        setSavedFlash(`Saved as use case ${id.slice(0, 8)}…`);
        // Defer navigation so the saved-flash banner is visible briefly
        setTimeout(() => router.push(`/use-cases/${id}`), 800);
      }
    } catch (err: any) {
      setSaveError(err.message || "Save failed");
    } finally { setSaving(null); }
  };

  // Save this tab as a row in the AtomicTest library (used by /atomic-tests).
  // Independent of Save-to-platform: a row in the library is reusable as a
  // step in any future UseCase via the Atomic Test catalogue.
  const saveToLibrary = async () => {
    if (!active || !canSave) return;
    setSaving("library"); setSaveError(null); setSavedFlash(null);
    try {
      const res = await fetch("/api/atomic-tests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(active.v),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save to library failed");
      setTabs((arr) => arr.map((x) => x.id === active.id ? { ...x, dirty: false, saved: true } : x));
      setSavedFlash(
        <>
          Added to Atomic Test Library: <strong>{data.testName}</strong> ({data.techniqueId} · test #{data.testNumber}).{" "}
          <Link href={`/atomic-tests?search=${encodeURIComponent(data.testName)}`} style={{ color: "#60a5fa", textDecoration: "underline" }}>
            View in library →
          </Link>
        </>
      );
    } catch (err: any) {
      setSaveError(err.message || "Save to library failed");
    } finally { setSaving(null); }
  };

  const saveAll = async () => {
    const dirtyTabs = tabs.filter((t) => t.dirty && allOk(validateAtomic(t.v)));
    if (dirtyTabs.length === 0) return;
    setSaving("all"); setSaveError(null); setSavedFlash(null);
    try {
      const ids: string[] = [];
      for (const t of dirtyTabs) {
        const id = await saveTab(t);
        if (id) ids.push(id);
        setTabs((arr) => arr.map((x) => x.id === t.id ? { ...x, dirty: false, saved: true } : x));
      }
      setSavedFlash(`Saved ${ids.length} tab${ids.length !== 1 ? "s" : ""}.`);
    } catch (err: any) {
      setSaveError(err.message || "Bulk save failed");
    } finally { setSaving(null); }
  };

  const downloadYaml = () => {
    if (!active) return;
    const blob = new Blob([yamlBody], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(active.v.name || "atomic-test").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.yml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Tab metas for the strip
  const tabMetas: TabMeta[] = tabs.map((t) => ({
    id: t.id, label: tabLabel(t), hint: tabHint(t),
    dirty: t.dirty, saved: t.saved,
  }));

  const dirtyCount = tabs.filter((t) => t.dirty).length;

  if (!active) return null;

  // Shorthand for the active tab (avoids `active.` everywhere below)
  const v = active.v;

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
        {/* ─── Sticky tab strip ─── */}
        <Box sx={{
          position: "sticky", top: 0, zIndex: 30,
          background: "linear-gradient(180deg, #0a0e1a 70%, transparent)",
          pt: 0.5, mb: 2,
        }}>
          <TabStrip
            tabs={tabMetas}
            activeId={activeId}
            onSwitch={setActiveId}
            onAdd={addTab}
            onClose={closeTab}
          />
        </Box>

        {savedFlash && (
          <Alert severity="success" onClose={() => setSavedFlash(null)} sx={{ mb: 2 }}>
            {savedFlash}
          </Alert>
        )}

        <Box sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.05fr) minmax(0, 1fr)" },
          gap: 3,
          minWidth: 0,
        }}>

          {/* ─── LEFT COLUMN ─── */}
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            {/* Action row */}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button
                size="small" variant="outlined" startIcon={<LibraryBooksIcon fontSize="small" />}
                endIcon={<KeyboardArrowDownIcon fontSize="small" />}
                onClick={(e) => setSampleAnchor(e.currentTarget)}
                sx={{ borderRadius: 1.5 }}
              >
                Load Sample
              </Button>
              <Menu open={!!sampleAnchor} anchorEl={sampleAnchor} onClose={() => setSampleAnchor(null)}>
                {SAMPLES.map((s) => (
                  <MenuItem key={s.id} onClick={() => { loadIntoActive(s.build()); setSampleAnchor(null); }}>
                    <ListItemText
                      primary={s.label}
                      secondary={`${s.techniqueId} · ${s.techniqueName}`}
                      primaryTypographyProps={{ fontSize: 13 }}
                      secondaryTypographyProps={{ fontSize: 11 }}
                    />
                  </MenuItem>
                ))}
              </Menu>
              <Button size="small" variant="outlined" startIcon={<CloudDownloadIcon fontSize="small" />}
                onClick={() => setRepoOpen(true)} sx={{ borderRadius: 1.5 }}>
                Load from Repo
              </Button>
              <UploadYaml onLoad={loadIntoActive} />
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Discard this tab and start over">
                <IconButton size="small" onClick={resetActive}><RestartAltIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>

            {/* AI bar */}
            <AiAssistantBar
              key={active.id}                            /* re-mount when switching tabs so suggestions reset */
              aiConfigured={aiConfigured}
              onLoad={loadIntoActive}
              onAiResult={(r) => setActiveAiMeta(r.meta)}
            />
            {active.aiResultMeta && (
              <Alert severity="success" sx={{ "& .MuiAlert-message": { width: "100%" } }} onClose={() => setActiveAiMeta(null)}>
                <Typography variant="caption" sx={{ display: "block" }}>
                  Form pre-filled by {active.aiResultMeta.model} · {active.aiResultMeta.inputTokens}/{active.aiResultMeta.outputTokens} tok · ${active.aiResultMeta.costUsd.toFixed(4)}
                </Typography>
                {active.aiResultMeta.expectedSignal && (
                  <Typography variant="caption" sx={{ display: "block", mt: 0.5, color: "text.secondary" }}>
                    Expected signal: {active.aiResultMeta.expectedSignal}
                  </Typography>
                )}
              </Alert>
            )}

            {/* IDENTITY */}
            <SectionPaper>
              <SectionHeader icon={<FlagIcon fontSize="small" />} title="IDENTITY" />
              <Stack spacing={2}>
                <TechniquePicker
                  value={v.attack_technique ?? ""}
                  displayName={v.display_name ?? ""}
                  confirmBeforeOpen={() => {
                    // The picker overwrites attack_technique + display_name and,
                    // when the form is otherwise blank, the rest of the test.
                    // If the user has edits beyond technique/display_name, prompt
                    // before swapping technique so an accidental click doesn't
                    // silently clobber their work.
                    if (!active.dirty) return true;
                    const hasOtherEdits =
                      !!v.name || !!v.description ||
                      !!v.executor.command || !!v.executor.cleanup_command || !!v.executor.steps ||
                      v.input_arguments.length > 0 || v.dependencies.length > 0;
                    if (!hasOtherEdits) return true;
                    return confirm(
                      "You have unsaved changes in this tab. Open the technique picker?\n\n" +
                      "Picking a new technique will replace the technique ID and display name. " +
                      "The rest of your edits (name, description, command, etc.) will be preserved.",
                    );
                  }}
                  onPick={async (id, name) => {
                    setActiveV((prev) => ({ ...prev, attack_technique: id, display_name: name }));
                    setActivePickStatus({ kind: "loading", message: `Fetching ${id}.yaml…` });
                    try {
                      const res = await fetch(techniqueYamlUrl(id));
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      const text = await res.text();
                      if (/^\s*<(?:!doctype|html)\b/i.test(text)) {
                        throw new Error("Got HTML instead of YAML — network is blocking raw.githubusercontent.com.");
                      }
                      const parsed = yaml.load(text);
                      const split = splitUpstreamYaml(parsed);
                      if (split.tests.length === 0) {
                        setActivePickStatus({ kind: "miss", message: "No atomic_tests in upstream YAML — author from scratch." });
                        return;
                      }
                      setActiveV((prev) => {
                        const formIsEmptyOtherwise =
                          !prev.name && !prev.description &&
                          !prev.executor.command && !prev.executor.cleanup_command && !prev.executor.steps &&
                          prev.input_arguments.length === 0 && prev.dependencies.length === 0;
                        if (formIsEmptyOtherwise) {
                          return mergeUpstreamTestIntoForm(split.tests[0].raw, id, name);
                        }
                        return prev;
                      });
                      setActivePickStatus({
                        kind: "ok",
                        message: split.tests.length > 1
                          ? `Loaded first test (${split.tests[0].name}). ${split.tests.length - 1} more available via "Load from Repo".`
                          : `Loaded test (${split.tests[0].name}).`,
                      });
                    } catch (err: any) {
                      setActivePickStatus({
                        kind: "err",
                        message: `Couldn't auto-load ${id}.yaml: ${err?.message || err}. Fill the form manually or click "Load from Repo".`,
                      });
                    }
                  }}
                  onTextChange={(val) => {
                    updateActive("attack_technique", val || null);
                    setActivePickStatus(null);
                  }}
                  required
                  error={!(errs as any).attack_technique?.ok}
                  helperText={(errs as any).attack_technique?.message}
                />
                {active.pickStatus && (
                  <Alert
                    severity={
                      active.pickStatus.kind === "loading" ? "info" :
                      active.pickStatus.kind === "ok" ? "success" :
                      active.pickStatus.kind === "miss" ? "warning" : "error"
                    }
                    onClose={() => setActivePickStatus(null)}
                    sx={{ py: 0.5 }}
                  >
                    {active.pickStatus.kind === "loading" && <CircularProgress size={12} sx={{ mr: 1, verticalAlign: "middle" }} />}
                    {active.pickStatus.message}
                  </Alert>
                )}
                <TextField
                  label="Display name (technique name)" fullWidth size="small"
                  value={v.display_name ?? ""}
                  onChange={(e) => updateActive("display_name", e.target.value || null)}
                  error={!(errs as any).display_name?.ok}
                  helperText={(errs as any).display_name?.message}
                />
                <TextField
                  label="Test name *" fullWidth size="small"
                  value={v.name ?? ""}
                  onChange={(e) => updateActive("name", e.target.value || null)}
                  error={!(errs as any).name?.ok}
                  helperText={(errs as any).name?.message}
                />
                <TextField
                  label="Test description *" fullWidth multiline minRows={3} size="small"
                  value={v.description ?? ""}
                  onChange={(e) => updateActive("description", e.target.value || null)}
                  error={!(errs as any).description?.ok}
                  helperText={(errs as any).description?.message}
                />
                <Box>
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
                    Supported Platforms *
                    {!(errs as any).supported_platforms?.ok && (
                      <Typography component="span" color="error" sx={{ ml: 1, fontSize: "0.7rem" }}>
                        {(errs as any).supported_platforms?.message}
                      </Typography>
                    )}
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.5 }}>
                    {["windows","macos","linux","office-365","azure-ad","google-workspace","saas","iaas","containers","iaas:gcp","iaas:azure","iaas:aws"].map((p) => {
                      const sel = v.supported_platforms.includes(p);
                      return (
                        <Chip
                          key={p} label={p} size="small"
                          color={sel ? "primary" : "default"}
                          variant={sel ? "filled" : "outlined"}
                          onClick={() => updateActive("supported_platforms",
                            sel ? v.supported_platforms.filter((x) => x !== p) : [...v.supported_platforms, p])}
                        />
                      );
                    })}
                  </Stack>
                </Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pt: 0.5 }}>
                  <Typography variant="caption" sx={{ color: "text.disabled" }}>
                    GUID <Box component="code" sx={{ fontFamily: "JetBrains Mono, monospace", ml: 0.5, fontSize: 11 }}>
                      {v.auto_generated_guid || "auto-generated on first download"}
                    </Box>
                  </Typography>
                  <IconButton size="small" onClick={() => {
                    updateActive("auto_generated_guid",
                      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
                        const r = Math.random() * 16 | 0; const vv = c === "x" ? r : (r & 0x3 | 0x8); return vv.toString(16);
                      }));
                  }}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
            </SectionPaper>

            {/* EXECUTION */}
            <SectionPaper>
              <SectionHeader icon={<TerminalIcon fontSize="small" />} title="EXECUTION" />
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
                  <TextField
                    select label="Attack Executor *" sx={{ minWidth: 220, flex: 1 }} size="small"
                    value={v.executor.name || ""}
                    onChange={(e) => updateExecutor({ name: e.target.value })}
                    error={!(errs as any).executor_name?.ok}
                    helperText={(errs as any).executor_name?.message}
                  >
                    {EXECUTOR_NAMES.map((n) => (<MenuItem key={n} value={n}>{n}</MenuItem>))}
                  </TextField>
                  <FormControlLabel
                    control={<Switch checked={v.executor.elevation_required} onChange={(e) => updateExecutor({ elevation_required: e.target.checked })} />}
                    label="Elevation required"
                    sx={{ ml: 0.5, whiteSpace: "nowrap" }}
                  />
                </Stack>

                <Box>
                  <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap">
                    <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600 }}>Input arguments</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      — referenced as <Box component="code" sx={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, background: "rgba(0,0,0,0.3)", px: 0.5, borderRadius: 0.5 }}>#{"{name}"}</Box> inside command
                    </Typography>
                  </Stack>
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    {v.input_arguments.map((a, i) => (
                      <Stack key={i} direction="row" spacing={1} alignItems="flex-start" sx={{ flexWrap: "wrap" }}>
                        <TextField label="Name" value={a.name} sx={{ flex: 1, minWidth: 100 }} size="small" onChange={(e) => {
                          const next = [...v.input_arguments]; next[i] = { ...a, name: e.target.value }; updateActive("input_arguments", next);
                        }} />
                        <TextField select label="Type" value={a.type} sx={{ width: 110 }} size="small" onChange={(e) => {
                          const next = [...v.input_arguments]; next[i] = { ...a, type: e.target.value }; updateActive("input_arguments", next);
                        }}>
                          {INPUT_ARGUMENT_TYPES.map((t) => (<MenuItem key={t} value={t}>{t}</MenuItem>))}
                        </TextField>
                        <TextField label="Default" value={a.default ?? ""} sx={{ flex: 1, minWidth: 100 }} size="small" onChange={(e) => {
                          const next = [...v.input_arguments]; next[i] = { ...a, default: e.target.value }; updateActive("input_arguments", next);
                        }} />
                        <IconButton size="small" onClick={() => updateActive("input_arguments", v.input_arguments.filter((_, j) => j !== i))}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ))}
                    <Button
                      size="small" variant="outlined" startIcon={<AddIcon fontSize="small" />}
                      onClick={() => updateActive("input_arguments", [...v.input_arguments, { name: "", type: "string", description: "", default: "" }])}
                      sx={{ alignSelf: "flex-start", borderRadius: 1.5 }}
                    >
                      Add input argument
                    </Button>
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600, display: "block", mb: 0.5 }}>
                    Attack command *
                  </Typography>
                  {v.executor.name !== "manual" ? (
                    <Paper variant="outlined" sx={{ overflow: "hidden", minWidth: 0 }}>
                      <CodeMirror
                        value={v.executor.command ?? ""}
                        onChange={(val) => updateExecutor({ command: val || null })}
                        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                        extensions={CM_CODE_EXTENSIONS}
                        theme="dark"
                        placeholder="Write an attack command / script"
                        minHeight="80px"
                        style={{ maxWidth: "100%" }}
                      />
                    </Paper>
                  ) : (
                    <TextField
                      label="Manual steps" fullWidth multiline minRows={4} size="small"
                      value={v.executor.steps ?? ""}
                      onChange={(e) => updateExecutor({ steps: e.target.value || null })}
                      error={!(errs as any).executor_steps?.ok}
                      helperText={(errs as any).executor_steps?.message}
                    />
                  )}
                  {!(errs as any).executor_command?.ok && v.executor.name !== "manual" && (
                    <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
                      {(errs as any).executor_command?.message}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </SectionPaper>

            {/* SETUP & CLEANUP */}
            <Accordion
              key={`setup-${active.id}`}
              defaultExpanded={v.dependencies.length > 0 || !!v.executor.cleanup_command}
              disableGutters
              sx={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 2, "&:before": { display: "none" } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2.5 }}>
                <BuildIcon fontSize="small" sx={{ color: "primary.main", mr: 1 }} />
                <Box sx={{ flex: 1, fontWeight: 600, letterSpacing: 1, fontSize: 12, color: "text.secondary" }}>SETUP & CLEANUP</Box>
                <Typography variant="caption" sx={{ color: "text.disabled", mr: 1 }}>optional</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 2.5 }}>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600, display: "block", mb: 0.5 }}>
                      Cleanup command
                    </Typography>
                    <Paper variant="outlined" sx={{ overflow: "hidden", minWidth: 0 }}>
                      <CodeMirror
                        value={v.executor.cleanup_command ?? ""}
                        onChange={(val) => updateExecutor({ cleanup_command: val || null })}
                        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                        extensions={CM_CODE_EXTENSIONS}
                        theme="dark"
                        placeholder="Optional: command to undo the attack"
                        minHeight="60px"
                        style={{ maxWidth: "100%" }}
                      />
                    </Paper>
                  </Box>
                  <Divider />
                  <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap">
                    <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600 }}>Dependencies</Typography>
                    <Button size="small" variant="text" startIcon={<AddIcon fontSize="small" />}
                      onClick={() => updateActive("dependencies", [...v.dependencies, { description: "", prereq_command: "", get_prereq_command: "" }])}>
                      Add dependency
                    </Button>
                  </Stack>
                  {v.dependencies.length > 0 && (
                    <TextField
                      select label="Dependency executor" size="small"
                      value={v.dependency_executor_name}
                      onChange={(e) => updateActive("dependency_executor_name", e.target.value)}
                    >
                      {EXECUTOR_NAMES.filter((x) => x !== "manual").map((n) => (<MenuItem key={n} value={n}>{n}</MenuItem>))}
                    </TextField>
                  )}
                  {v.dependencies.map((d, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 1.5, position: "relative", minWidth: 0 }}>
                      <IconButton size="small" sx={{ position: "absolute", top: 4, right: 4 }}
                        onClick={() => updateActive("dependencies", v.dependencies.filter((_, j) => j !== i))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                      <Stack spacing={1}>
                        <TextField label="Description" size="small" value={d.description} onChange={(e) => {
                          const next = [...v.dependencies]; next[i] = { ...d, description: e.target.value }; updateActive("dependencies", next);
                        }} />
                        <TextField label="Prereq check command" multiline minRows={2} size="small" value={d.prereq_command} onChange={(e) => {
                          const next = [...v.dependencies]; next[i] = { ...d, prereq_command: e.target.value }; updateActive("dependencies", next);
                        }} />
                        <TextField label="Get prereq command (optional)" multiline minRows={2} size="small" value={d.get_prereq_command ?? ""} onChange={(e) => {
                          const next = [...v.dependencies]; next[i] = { ...d, get_prereq_command: e.target.value }; updateActive("dependencies", next);
                        }} />
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>

            {/* Sticky save bar */}
            {saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
            <Box sx={{
              position: "sticky", bottom: 0, zIndex: 20,
              background: "linear-gradient(to top, #0a0e1a 70%, transparent)",
              pt: 2, pb: 1,
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1,
              flexWrap: "wrap",
            }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {dirtyCount > 0
                  ? <>{dirtyCount} unsaved tab{dirtyCount !== 1 ? "s" : ""}</>
                  : <>All tabs saved</>}
                {!canSave && <>  ·  current tab has validation errors</>}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                {dirtyCount > 1 && (
                  <Button
                    variant="outlined" size="medium"
                    onClick={saveAll}
                    disabled={saving !== null}
                    startIcon={saving === "all" ? <CircularProgress size={14} /> : <SaveIcon />}
                    sx={{ borderRadius: 1.5 }}
                  >
                    Save all ({dirtyCount})
                  </Button>
                )}
                <Tooltip title="Append this test as a row in the Atomic Test Library (reusable across future use cases). No new UseCase created.">
                  <span>
                    <Button
                      variant="outlined" size="medium"
                      onClick={saveToLibrary}
                      disabled={!canSave || saving !== null}
                      startIcon={saving === "library" ? <CircularProgress size={14} /> : <LocalLibraryIcon />}
                      sx={{
                        borderRadius: 1.5,
                        borderColor: "rgba(168,85,247,0.40)",
                        color: "#c084fc",
                        "&:hover": { borderColor: "#a855f7", background: "rgba(168,85,247,0.08)" },
                      }}
                    >
                      Save to Library
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title="Create a new UseCase from this test. Lands under Recent Use Cases; exportable to ART YAML / PurpleSharp JSON / Stratus shell.">
                  <span>
                    <Button
                      variant="contained" size="medium"
                      startIcon={saving === "current" ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                      disabled={!canSave || saving !== null}
                      onClick={saveCurrent}
                      sx={{
                        borderRadius: 1.5, fontWeight: 600, px: 3,
                        background: "linear-gradient(90deg, #3b82f6, #6366f1)",
                        "&:hover": { background: "linear-gradient(90deg, #60a5fa, #818cf8)" },
                      }}
                    >
                      Save to platform
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            </Box>
          </Stack>

          {/* ─── RIGHT COLUMN: YAML preview (platform-themed) ─── */}
          <Box sx={{ minWidth: 0 }}>
            <Paper
              variant="outlined"
              sx={{
                position: { lg: "sticky" }, top: { lg: 80 }, alignSelf: { lg: "flex-start" },
                height: "fit-content",
                maxHeight: { lg: "calc(100vh - 100px)" },
                display: "flex", flexDirection: "column",
                minWidth: 0,
                // Platform card tokens (matches Tailwind's bg-card + border-border)
                bgcolor: "#111827",
                borderColor: "#1e293b",
                borderRadius: 1.5,
                overflow: "hidden",
              }}
            >
              {/* Header — accent-blue icon plate (matches platform section header) */}
              <Stack
                direction="row" alignItems="center" justifyContent="space-between"
                sx={{
                  px: 2, py: 1.5,
                  borderBottom: "1px solid #1e293b",
                  background: "rgba(255,255,255,0.015)",
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.25}>
                  <Box sx={{
                    width: 28, height: 28, borderRadius: 1.25,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(59,130,246,0.10)",
                    border: "1px solid rgba(59,130,246,0.30)",
                    color: "primary.main",
                  }}>
                    <CodeIcon sx={{ fontSize: 16 }} />
                  </Box>
                  <Box>
                    <Typography sx={{
                      letterSpacing: 2, fontWeight: 700, color: "text.primary",
                      fontSize: 11, lineHeight: 1,
                    }}>
                      YAML PREVIEW
                    </Typography>
                    <Typography variant="caption" sx={{
                      color: "text.disabled", fontSize: 10.5,
                      fontFamily: "JetBrains Mono, monospace",
                      mt: 0.25, display: "block", lineHeight: 1,
                    }}>
                      atomic-red-team v1 schema
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Download .yml">
                    <span>
                      <IconButton size="small" onClick={downloadYaml} disabled={pristine}
                        sx={{ "&:hover": { color: "primary.main", background: "rgba(59,130,246,0.08)" } }}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Copy YAML">
                    <span>
                      <IconButton size="small" onClick={() => navigator.clipboard.writeText(yamlBody)} disabled={pristine}
                        sx={{ "&:hover": { color: "primary.main", background: "rgba(59,130,246,0.08)" } }}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Reset this tab">
                    <IconButton size="small" onClick={resetActive}
                      sx={{ "&:hover": { color: "warning.main", background: "rgba(245,158,11,0.08)" } }}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>

              {/* Body */}
              {pristine ? (
                <Box sx={{ flex: { lg: 1 }, display: "flex", alignItems: "center" }}>
                  <YamlEmptyState />
                </Box>
              ) : (
                <Box sx={{
                  flex: { lg: 1 }, minWidth: 0,
                  bgcolor: "#0a0e1a",                                  // match platform `background`
                  "& .cm-editor": { maxWidth: "100%" },
                  "& .cm-scroller": { overflowX: "hidden" },
                  "& .cm-gutters": {
                    backgroundColor: "#0d1424",
                    borderRight: "1px solid #1e293b",
                  },
                }}>
                  <CodeMirror
                    value={yamlBody}
                    editable={false}
                    extensions={CM_EXTENSIONS}
                    theme="dark"
                    basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
                    style={{ maxWidth: "100%", height: "100%" }}
                  />
                </Box>
              )}

              {/* Footer — provenance note */}
              <Box sx={{
                px: 2, py: 1,
                borderTop: "1px solid #1e293b",
                background: "rgba(255,255,255,0.015)",
              }}>
                <Typography variant="caption" sx={{ color: "text.disabled", fontSize: 10.5 }}>
                  UI derived from{" "}
                  <Box component="a" href="https://github.com/krdmnbrk/atomicgen.io"
                    target="_blank" rel="noreferrer"
                    sx={{
                      color: "primary.main", textDecoration: "none",
                      "&:hover": { textDecoration: "underline" },
                    }}>
                    atomicgen.io
                  </Box>{" "}
                  (Apache-2.0).
                </Typography>
              </Box>
            </Paper>
          </Box>
        </Box>

        <RepoLoader open={repoOpen} onClose={() => setRepoOpen(false)} onLoad={loadIntoActive} />
      </Box>
    </ThemeProvider>
  );
}

// ─── Small UI primitives ──────────────────────────────────────────────────────
function SectionPaper({ children }: { children: React.ReactNode }) {
  return (
    <Paper sx={{
      p: 2.5,
      background: "linear-gradient(180deg, #131c30, #111827)",
      borderRadius: 2,
      minWidth: 0,
    }}>
      {children}
    </Paper>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: 1.5,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(168,85,247,0.10))",
        border: "1px solid rgba(59,130,246,0.30)",
        color: "primary.main",
      }}>
        {icon}
      </Box>
      <Typography variant="caption" sx={{
        letterSpacing: 2, fontWeight: 700, color: "text.primary", fontSize: 11,
      }}>
        {title}
      </Typography>
    </Stack>
  );
}
