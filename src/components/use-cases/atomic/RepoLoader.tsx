"use client";
/**
 * "Load from Repo" — browse the upstream atomic-red-team CSV index, pick a
 * technique, see all its tests, pick one → fetched YAML is parsed and
 * pushed into the form via `onLoad(merged: AtomicYamlInput)`.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Box, Button, Dialog, DialogTitle, DialogContent, IconButton,
  InputAdornment, TextField, Typography, CircularProgress, Stack, Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import * as yaml from "js-yaml";
import useAtomicIndex, { techniqueYamlUrl, type AtomicIndexTechnique } from "./useAtomicIndex";
import { splitUpstreamYaml, mergeUpstreamTestIntoForm } from "./yaml-merge";
import type { AtomicYamlInput } from "@/lib/use-cases/types";

type Stage = "techniques" | "tests";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (input: AtomicYamlInput) => void;
}

interface TestEntry { idx: number; name: string; raw: any }

export default function RepoLoader({ open, onClose, onLoad }: Props) {
  const { data, loading: indexLoading, error: indexError } = useAtomicIndex();
  const [stage, setStage] = useState<Stage>("techniques");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AtomicIndexTechnique | null>(null);

  // After picking a technique we fetch its YAML
  const [yamlLoading, setYamlLoading] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [yamlBody, setYamlBody] = useState<string | null>(null);
  const [tests, setTests] = useState<TestEntry[]>([]);
  const [techniqueId, setTechniqueId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Reset on close
      setStage("techniques"); setQuery(""); setSelected(null);
      setYamlLoading(false); setYamlError(null); setYamlBody(null);
      setTests([]); setTechniqueId(null); setDisplayName(null);
    }
  }, [open]);

  // Tests-per-technique counts from the CSV — used to show "N tests" badge.
  const testCountByTid = useMemo(() => {
    const m = new Map<string, number>();
    if (!data?.tests) return m;
    for (const t of data.tests) {
      m.set(t.tid, (m.get(t.tid) || 0) + 1);
    }
    return m;
  }, [data]);

  const techniques = useMemo(() => {
    if (!data?.techniques) return [];
    const q = query.trim().toLowerCase();
    return data.techniques.filter((t) =>
      !q || t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    ).slice(0, 400);
  }, [data, query]);

  const fetchYamlFor = async (tech: AtomicIndexTechnique) => {
    setStage("tests"); setSelected(tech); setYamlLoading(true);
    setYamlError(null); setYamlBody(null); setTests([]);
    try {
      const r = await fetch(techniqueYamlUrl(tech.id));
      if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${tech.id}.yaml`);
      const text = await r.text();
      if (/^\s*<(?:!doctype|html)\b/i.test(text)) {
        throw new Error("Got HTML instead of YAML — your network may be blocking raw.githubusercontent.com.");
      }
      const parsed = yaml.load(text);
      const split = splitUpstreamYaml(parsed);
      setYamlBody(text);
      setTechniqueId(split.techniqueId || tech.id);
      setDisplayName(split.displayName || tech.name);
      setTests(split.tests.map((t, i) => ({ idx: i, name: t.name, raw: t.raw })));
    } catch (err: any) {
      setYamlError(err?.message || "Failed to load YAML");
    } finally { setYamlLoading(false); }
  };

  const loadTest = (entry: TestEntry) => {
    const merged = mergeUpstreamTestIntoForm(entry.raw, techniqueId, displayName);
    onLoad(merged);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: "#111827", minHeight: 480 } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        {stage === "tests" && (
          <IconButton size="small" onClick={() => setStage("techniques")}><ArrowBackIcon fontSize="small" /></IconButton>
        )}
        <Box sx={{ flex: 1 }}>
          {stage === "techniques" ? "Load from atomic-red-team" : `${selected?.id} · ${selected?.name}`}
        </Box>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>

      <DialogContent>
        {stage === "techniques" && (
          <>
            <TextField
              autoFocus fullWidth size="small"
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search techniques…"
              sx={{ mb: 1.5 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
            {indexLoading && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">Loading atomic-red-team index…</Typography>
              </Stack>
            )}
            {indexError && <Alert severity="warning">{indexError.message}</Alert>}
            {!indexLoading && !indexError && (
              <Box sx={{ maxHeight: 380, overflowY: "auto" }}>
                {techniques.map((t) => (
                  <Box
                    key={t.id}
                    onClick={() => fetchYamlFor(t)}
                    sx={{
                      px: 1.5, py: 1, borderRadius: 1, cursor: "pointer", mb: 0.5,
                      display: "flex", alignItems: "center", gap: 1,
                      "&:hover": { background: "rgba(255,255,255,0.04)" },
                    }}
                  >
                    <Box sx={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "primary.main", minWidth: 80 }}>{t.id}</Box>
                    <Box sx={{ flex: 1, fontSize: 13, color: "text.primary" }}>{t.name}</Box>
                    <Box sx={{ fontSize: 11, color: "text.secondary" }}>
                      {testCountByTid.get(t.id) || 0} test{(testCountByTid.get(t.id) || 0) !== 1 ? "s" : ""}
                    </Box>
                    <ChevronRightIcon fontSize="small" sx={{ color: "text.disabled" }} />
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}

        {stage === "tests" && (
          <>
            {yamlLoading && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">Fetching {selected?.id}.yaml…</Typography>
              </Stack>
            )}
            {yamlError && <Alert severity="warning">{yamlError}</Alert>}
            {!yamlLoading && !yamlError && (
              <>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
                  Pick which test to load into the form. The technique id + display name will be applied automatically.
                </Typography>
                <Box sx={{ maxHeight: 380, overflowY: "auto" }}>
                  {tests.map((t) => (
                    <Box
                      key={t.idx}
                      onClick={() => loadTest(t)}
                      sx={{
                        px: 1.5, py: 1, borderRadius: 1, cursor: "pointer", mb: 0.5,
                        border: "1px solid", borderColor: "divider",
                        "&:hover": { background: "rgba(59,130,246,0.06)", borderColor: "primary.main" },
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{t.name}</Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        executor: {(t.raw?.executor?.name ?? "?")} ·
                        platforms: {(t.raw?.supported_platforms || []).join(", ") || "?"}
                      </Typography>
                    </Box>
                  ))}
                  {tests.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      This technique has no atomic_tests in its YAML.
                    </Typography>
                  )}
                </Box>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
