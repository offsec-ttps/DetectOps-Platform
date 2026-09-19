"use client";
/**
 * PurpleSharp playbook builder.
 *
 * Mirrors AtomicGen's UX grammar (left form, right live preview) but the form
 * is a tree (root → playbooks → tasks) matching the verified JSON shape from
 * mvelazc0/PurpleTeamPlaybook. Templates can be loaded into the editor; the
 * builder then persists as a `UseCase` with one `UseCaseStep` per task.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ThemeProvider, createTheme, CssBaseline,
  Box, Stack, TextField, MenuItem, Button, IconButton, Switch, FormControlLabel,
  Typography, Divider, Paper, Alert, CircularProgress, Tooltip, Autocomplete,
  Dialog, DialogTitle, DialogContent, DialogActions, InputAdornment,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import SyncIcon from "@mui/icons-material/Sync";
import SearchIcon from "@mui/icons-material/Search";
import CodeMirror from "@uiw/react-codemirror";
import { json as cmJson } from "@codemirror/lang-json";

interface VariationRow {
  techniqueId: string;
  techniqueName: string;
  variation: number;
  variationLabel: string;
  requiresUrl: boolean;
  requiresCommand: boolean;
}

interface TemplateRow {
  id: string;
  scenarioPath: string;
  group: string;
  category: string;
  name: string;
  description: string;
  rawJson: string;
  mitreTechniques: string[];
  sourceUrl: string;
}

interface Task {
  technique_id: string;
  technique_name: string;
  variation: number;
  url?: string;
  command?: string;
}
interface PlaybookEntry {
  name: string;
  enabled: boolean;
  task_sleep: number;
  tasks: Task[];
}
interface RootPlaybook {
  type: "local" | "remote";
  sleep: number;
  playbooks: PlaybookEntry[];
}

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0a0e1a", paper: "#111827" },
    primary: { main: "#a855f7" },                     // purple to match the brand for PS
    secondary: { main: "#3b82f6" },
    error: { main: "#ef4444" },
    success: { main: "#22c55e" },
    warning: { main: "#f59e0b" },
  },
  shape: { borderRadius: 8 },
  typography: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontSize: 13 },
  components: {
    MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
    MuiButton: { styleOverrides: { root: { textTransform: "none" } } },
  },
});

const emptyPlaybook = (): PlaybookEntry => ({
  name: "New Playbook",
  enabled: true,
  task_sleep: 3,
  tasks: [],
});

export default function PurpleSharpBuilder() {
  const router = useRouter();
  const [root, setRoot] = useState<RootPlaybook>({
    type: "local",
    sleep: 5,
    playbooks: [emptyPlaybook()],
  });
  const [name, setName] = useState("PurpleSharp Use Case");
  const [description, setDescription] = useState("");

  const [variations, setVariations] = useState<VariationRow[]>([]);
  const [loadingVariations, setLoadingVariations] = useState(false);
  const [syncing, setSyncing] = useState<"variations" | "templates" | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesSearch, setTemplatesSearch] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initial load — variations are tiny, fetch on mount
  useEffect(() => {
    setLoadingVariations(true);
    fetch("/api/purplesharp-variations")
      .then((r) => r.json())
      .then((d) => setVariations(d.items || []))
      .catch(() => setVariations([]))
      .finally(() => setLoadingVariations(false));
  }, []);

  const techniques = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const v of variations) {
      if (!m.has(v.techniqueId)) m.set(v.techniqueId, { id: v.techniqueId, name: v.techniqueName });
    }
    return [...m.values()];
  }, [variations]);

  const variationsFor = (techniqueId: string) =>
    variations.filter((v) => v.techniqueId === techniqueId);

  // Live JSON preview
  const jsonBody = useMemo(() => {
    // Strip undefined optional fields per task for clean JSON
    const cleaned: RootPlaybook = {
      type: root.type,
      sleep: root.sleep,
      playbooks: root.playbooks.map((p) => ({
        name: p.name,
        enabled: p.enabled,
        task_sleep: p.task_sleep,
        tasks: p.tasks.map((t) => {
          const o: Record<string, unknown> = {
            technique_id: t.technique_id,
            technique_name: t.technique_name,
            variation: t.variation,
          };
          if (t.url) o.url = t.url;
          if (t.command) o.command = t.command;
          return o as unknown as Task;
        }),
      })),
    };
    return JSON.stringify(cleaned, null, 2) + "\n";
  }, [root]);

  // Update helpers
  const updatePlaybook = (idx: number, patch: Partial<PlaybookEntry>) =>
    setRoot((r) => ({
      ...r,
      playbooks: r.playbooks.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  const removePlaybook = (idx: number) =>
    setRoot((r) => ({ ...r, playbooks: r.playbooks.filter((_, i) => i !== idx) }));
  const addPlaybook = () =>
    setRoot((r) => ({ ...r, playbooks: [...r.playbooks, emptyPlaybook()] }));

  const addTask = (pbIdx: number, techniqueId: string) => {
    const tech = techniques.find((t) => t.id === techniqueId);
    if (!tech) return;
    const firstVariation = variationsFor(techniqueId)[0];
    const newTask: Task = {
      technique_id: tech.id,
      technique_name: tech.name,
      variation: firstVariation?.variation ?? 1,
    };
    updatePlaybook(pbIdx, { tasks: [...root.playbooks[pbIdx].tasks, newTask] });
  };
  const updateTask = (pbIdx: number, tIdx: number, patch: Partial<Task>) => {
    const updated = [...root.playbooks[pbIdx].tasks];
    updated[tIdx] = { ...updated[tIdx], ...patch };
    updatePlaybook(pbIdx, { tasks: updated });
  };
  const removeTask = (pbIdx: number, tIdx: number) => {
    const filtered = root.playbooks[pbIdx].tasks.filter((_, i) => i !== tIdx);
    updatePlaybook(pbIdx, { tasks: filtered });
  };

  // Sync handlers
  const syncVariations = async () => {
    setSyncing("variations"); setSyncMessage(null);
    try {
      const res = await fetch("/api/purplesharp-variations/sync", { method: "POST" });
      const d = await res.json();
      setSyncMessage(`Variations: ${d.upsertedCount}/${d.variationsTotal} across ${d.techniques} techniques`);
      // Refresh list
      const r2 = await fetch("/api/purplesharp-variations");
      setVariations((await r2.json()).items || []);
    } catch (err: any) { setSyncMessage(`Sync failed: ${err.message}`); }
    finally { setSyncing(null); }
  };
  const syncTemplates = async () => {
    setSyncing("templates"); setSyncMessage(null);
    try {
      const res = await fetch("/api/purplesharp-templates/sync", { method: "POST" });
      const d = await res.json();
      setSyncMessage(`Templates: ${d.upserted} upserted, ${d.unchanged} unchanged, ${d.errors?.length || 0} errors`);
    } catch (err: any) { setSyncMessage(`Sync failed: ${err.message}`); }
    finally { setSyncing(null); }
  };

  // Templates browser
  const openTemplates = async () => {
    setTemplatesOpen(true);
    try {
      const r = await fetch("/api/purplesharp-templates?pageSize=200");
      const d = await r.json();
      setTemplates(d.items || []);
    } catch { setTemplates([]); }
  };
  // Detect "user has work in progress" — used to gate destructive Load Template.
  const hasUserContent = () => {
    if (name && name !== "PurpleSharp Use Case") return true;
    if (description.trim()) return true;
    if (root.playbooks.length > 1) return true;
    const p = root.playbooks[0];
    if (!p) return false;
    if (p.name !== "New Playbook") return true;
    if (p.tasks.length > 0) return true;
    return false;
  };

  const loadTemplate = (t: TemplateRow) => {
    if (hasUserContent() && !confirm(
      `Loading "${t.name}" will replace your current work in this builder.\n\n` +
      "Do you want to leave the use case editing and load the template?",
    )) return;
    try {
      const parsed = JSON.parse(t.rawJson) as RootPlaybook;
      // Defensive defaults
      setRoot({
        type: parsed.type === "remote" ? "remote" : "local",
        sleep: typeof parsed.sleep === "number" ? parsed.sleep : 5,
        playbooks: Array.isArray(parsed.playbooks) && parsed.playbooks.length > 0
          ? parsed.playbooks.map((p) => ({
              name: p.name || "Playbook",
              enabled: p.enabled !== false,
              task_sleep: typeof p.task_sleep === "number" ? p.task_sleep : 3,
              tasks: Array.isArray(p.tasks) ? p.tasks.map((t) => ({
                technique_id: String(t.technique_id),
                technique_name: String(t.technique_name || ""),
                variation: typeof t.variation === "number" ? t.variation : 1,
                ...(t.url ? { url: String(t.url) } : {}),
                ...(t.command ? { command: String(t.command) } : {}),
              })) : [],
            }))
          : [emptyPlaybook()],
      });
      setName(t.name);
      setDescription(t.description || `Loaded from ${t.scenarioPath}`);
      setTemplatesOpen(false);
    } catch (err: any) { alert(`Template parse failed: ${err.message}`); }
  };

  const filteredTemplates = useMemo(() => {
    if (!templatesSearch) return templates;
    const q = templatesSearch.toLowerCase();
    return templates.filter((t) =>
      [t.name, t.description, t.group, t.scenarioPath].some((s) => s.toLowerCase().includes(q)),
    );
  }, [templates, templatesSearch]);

  // Save
  const totalTasks = root.playbooks.reduce((acc, p) => acc + p.tasks.length, 0);
  const canSave = name.trim().length > 0 && totalTasks > 0;

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      // Steps: one per task across all playbooks; preserve playbook structure in `parameters`
      const steps: Array<any> = [];
      let order = 0;
      for (const [pbIdx, pb] of root.playbooks.entries()) {
        for (const t of pb.tasks) {
          steps.push({
            orderIndex: order++,
            kind: "purplesharp",
            techniqueId: t.technique_id,
            displayName: t.technique_name || t.technique_id,
            parameters: {
              purplesharp: {
                variation: t.variation,
                ...(t.url ? { url: t.url } : {}),
                ...(t.command ? { command: t.command } : {}),
              },
              expectedSignal: "",
              // Preserve grouping context for round-trip
              _playbook: { index: pbIdx, name: pb.name, enabled: pb.enabled, task_sleep: pb.task_sleep },
            },
            expectedSignal: "",
            notes: "",
          });
        }
      }

      const res = await fetch("/api/use-cases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, description,
          authorMode: "purplesharp",
          framework: "purplesharp",
          source: "manual",
          platforms: ["windows"],
          steps,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      router.push(`/use-cases/${data.id}`);
    } catch (err: any) { setSaveError(err.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 3 }}>

        {/* LEFT — form */}
        <Paper variant="outlined" sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Use Case meta */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexWrap: "wrap", gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Use case</Typography>
            <Stack direction="row" spacing={1}>
              <Tooltip title="Refresh PurpleSharp variation catalogue">
                <Button size="small" startIcon={syncing === "variations" ? <CircularProgress size={12} /> : <SyncIcon />} onClick={syncVariations} disabled={!!syncing}>
                  Sync variations
                </Button>
              </Tooltip>
              <Tooltip title="Refresh PurpleTeamPlaybook templates from GitHub">
                <Button size="small" startIcon={syncing === "templates" ? <CircularProgress size={12} /> : <SyncIcon />} onClick={syncTemplates} disabled={!!syncing}>
                  Sync templates
                </Button>
              </Tooltip>
              <Button size="small" startIcon={<LibraryBooksIcon />} onClick={openTemplates}>
                Load template
              </Button>
            </Stack>
          </Stack>
          {syncMessage && <Alert severity="info">{syncMessage}</Alert>}

          <TextField label="Name" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Description" fullWidth multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} />

          <Divider />

          {/* Root header */}
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Root configuration</Typography>
          <Stack direction="row" spacing={1.5}>
            <TextField select label="Type" value={root.type} onChange={(e) => setRoot((r) => ({ ...r, type: e.target.value as "local" | "remote" }))} sx={{ width: 140 }}>
              <MenuItem value="local">local</MenuItem>
              <MenuItem value="remote">remote</MenuItem>
            </TextField>
            <TextField label="sleep (sec)" type="number" value={root.sleep} onChange={(e) => setRoot((r) => ({ ...r, sleep: Math.max(0, parseInt(e.target.value || "0", 10)) }))} sx={{ width: 130 }} />
          </Stack>

          <Divider />

          {/* Playbooks */}
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Playbooks ({root.playbooks.length}) · {totalTasks} task{totalTasks !== 1 ? "s" : ""}
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={addPlaybook}>Add playbook</Button>
          </Stack>
          {root.playbooks.map((pb, pbIdx) => (
            <Paper key={pbIdx} variant="outlined" sx={{ p: 1.5, position: "relative" }}>
              <IconButton size="small" onClick={() => removePlaybook(pbIdx)} sx={{ position: "absolute", top: 4, right: 4 }} disabled={root.playbooks.length === 1}>
                <DeleteIcon fontSize="small" />
              </IconButton>
              <Stack spacing={1}>
                <TextField label="Playbook name" value={pb.name} onChange={(e) => updatePlaybook(pbIdx, { name: e.target.value })} />
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <FormControlLabel control={<Switch checked={pb.enabled} onChange={(e) => updatePlaybook(pbIdx, { enabled: e.target.checked })} />} label="Enabled" />
                  <TextField label="task_sleep (sec)" type="number" value={pb.task_sleep} onChange={(e) => updatePlaybook(pbIdx, { task_sleep: Math.max(0, parseInt(e.target.value || "0", 10)) })} sx={{ width: 150 }} />
                </Stack>

                {/* Tasks */}
                <Box>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5, mb: 0.5 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Tasks ({pb.tasks.length})
                    </Typography>
                    <Autocomplete
                      size="small"
                      options={techniques}
                      getOptionLabel={(o) => `${o.id}  ${o.name}`}
                      sx={{ width: 320 }}
                      loading={loadingVariations}
                      renderInput={(p) => <TextField {...p} placeholder="Add task: pick technique" />}
                      onChange={(_, value) => { if (value) addTask(pbIdx, value.id); }}
                      value={null}
                      isOptionEqualToValue={(a, b) => a.id === b.id}
                      blurOnSelect
                      clearOnBlur
                    />
                  </Stack>
                  {pb.tasks.map((t, tIdx) => {
                    const varRows = variationsFor(t.technique_id);
                    const varRow = varRows.find((v) => v.variation === t.variation);
                    return (
                      <Box key={tIdx} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5, mb: 1, position: "relative" }}>
                        <IconButton size="small" onClick={() => removeTask(pbIdx, tIdx)} sx={{ position: "absolute", top: 4, right: 4 }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                        <Stack direction="row" spacing={1} sx={{ pr: 4 }} flexWrap="wrap" useFlexGap>
                          <TextField label="Technique ID" value={t.technique_id} onChange={(e) => updateTask(pbIdx, tIdx, { technique_id: e.target.value })} sx={{ width: 140 }} />
                          <TextField label="Name" value={t.technique_name} onChange={(e) => updateTask(pbIdx, tIdx, { technique_name: e.target.value })} sx={{ flex: 1, minWidth: 200 }} />
                          <TextField
                            select label="Variation" value={t.variation}
                            onChange={(e) => updateTask(pbIdx, tIdx, { variation: parseInt(e.target.value, 10) })}
                            sx={{ width: 220 }}
                          >
                            {(varRows.length ? varRows : [{ techniqueId: t.technique_id, variation: 1, variationLabel: "", techniqueName: "", requiresUrl: false, requiresCommand: false }]).map((v) => (
                              <MenuItem key={v.variation} value={v.variation}>
                                {v.variation}{v.variationLabel ? ` · ${v.variationLabel}` : ""}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Stack>
                        {/* Conditional url/command — show if the variation row says so OR if the user already populated them */}
                        {(varRow?.requiresUrl || t.url) && (
                          <TextField fullWidth sx={{ mt: 1 }} label="url" value={t.url || ""} onChange={(e) => updateTask(pbIdx, tIdx, { url: e.target.value })} />
                        )}
                        {(varRow?.requiresCommand || t.command) && (
                          <TextField fullWidth sx={{ mt: 1 }} label="command" value={t.command || ""} onChange={(e) => updateTask(pbIdx, tIdx, { command: e.target.value })} />
                        )}
                      </Box>
                    );
                  })}
                  {pb.tasks.length === 0 && (
                    <Typography variant="caption" sx={{ color: "text.disabled", display: "block", textAlign: "center", py: 1 }}>
                      No tasks yet. Use the autocomplete above to add a technique.
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Paper>
          ))}

          {saveError && <Alert severity="error">{saveError}</Alert>}

          <Box sx={{ position: "sticky", bottom: 0, pt: 1, display: "flex", justifyContent: "flex-end", gap: 1, background: "linear-gradient(to top, #111827 70%, transparent)" }}>
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
              disabled={!canSave || saving}
              onClick={save}
            >
              Save to platform
            </Button>
          </Box>
        </Paper>

        {/* RIGHT — JSON preview */}
        <Paper variant="outlined" sx={{ p: 2.5, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>JSON preview</Typography>
            <Button size="small" onClick={() => navigator.clipboard.writeText(jsonBody)}>Copy</Button>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 360, border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "auto" }}>
            <CodeMirror value={jsonBody} editable={false} extensions={[cmJson()]} theme="dark" basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }} />
          </Box>
          <Typography variant="caption" sx={{ color: "text.secondary", mt: 1.5 }}>
            Variations parsed from upstream <a href="https://github.com/mvelazc0/PurpleSharp" target="_blank" rel="noreferrer" style={{ color: "#a855f7" }}>PurpleSharp Program.cs</a>.
            Templates from <a href="https://github.com/mvelazc0/PurpleTeamPlaybook" target="_blank" rel="noreferrer" style={{ color: "#a855f7" }}>PurpleTeamPlaybook</a>.
          </Typography>
        </Paper>

      </Box>

      {/* Templates dialog */}
      <Dialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Load PurpleTeamPlaybook template</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth size="small" placeholder="Search by name, group, or path"
            value={templatesSearch} onChange={(e) => setTemplatesSearch(e.target.value)}
            sx={{ mb: 1.5 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          {filteredTemplates.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
              No templates loaded. Click "Sync templates" first.
            </Typography>
          ) : (
            <Box sx={{ maxHeight: 480, overflow: "auto" }}>
              {filteredTemplates.map((t) => (
                <Paper key={t.id} variant="outlined" sx={{ p: 1.5, mb: 1, cursor: "pointer", "&:hover": { borderColor: "primary.main" } }} onClick={() => loadTemplate(t)}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                        {t.group ? `${t.group} · ` : ""}{t.mitreTechniques.length} technique{t.mitreTechniques.length !== 1 ? "s" : ""}
                      </Typography>
                      {t.description && (
                        <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 0.5 }}>
                          {t.description.slice(0, 140)}
                        </Typography>
                      )}
                    </Box>
                    <Typography variant="caption" sx={{ color: "primary.main" }}>load →</Typography>
                  </Stack>
                </Paper>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTemplatesOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}
