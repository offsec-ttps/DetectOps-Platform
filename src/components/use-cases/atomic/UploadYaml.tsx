"use client";
/**
 * "Upload YAML" — accept a .yml/.yaml file or the user pastes the body.
 * If the YAML has multiple `atomic_tests`, show a picker. Otherwise load
 * straight into the form.
 */

import { useState } from "react";
import {
  Button, Dialog, DialogTitle, DialogContent, IconButton, Typography,
  Box, Alert, Stack,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UploadIcon from "@mui/icons-material/UploadFile";
import * as yaml from "js-yaml";
import { splitUpstreamYaml, mergeUpstreamTestIntoForm } from "./yaml-merge";
import type { AtomicYamlInput } from "@/lib/use-cases/types";

interface Props {
  onLoad: (input: AtomicYamlInput) => void;
}

interface TestEntry { idx: number; name: string; raw: any }

export default function UploadYaml({ onLoad }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<TestEntry[]>([]);
  const [techniqueId, setTechniqueId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    e.target.value = "";                                       // clear so the same file re-selects
    if (!f) return;
    if (!/\.ya?ml$/i.test(f.name)) {
      setError("Only .yaml or .yml files are supported.");
      return;
    }
    try {
      const text = await f.text();
      const parsed = yaml.load(text);
      const split = splitUpstreamYaml(parsed);
      if (split.tests.length === 0) {
        setError("YAML did not contain a recognizable atomic test.");
        return;
      }
      setFilename(f.name);
      setTechniqueId(split.techniqueId);
      setDisplayName(split.displayName);
      setTests(split.tests.map((t, i) => ({ idx: i, name: t.name, raw: t.raw })));
      if (split.tests.length === 1) {
        // Single-test shortcut
        const merged = mergeUpstreamTestIntoForm(split.tests[0].raw, split.techniqueId, split.displayName);
        onLoad(merged);
      } else {
        setPickerOpen(true);
      }
    } catch (err: any) {
      setError(err?.message || "YAML parse error");
    }
  };

  const loadTest = (entry: TestEntry) => {
    const merged = mergeUpstreamTestIntoForm(entry.raw, techniqueId, displayName);
    onLoad(merged);
    setPickerOpen(false);
  };

  return (
    <>
      <Button
        component="label"
        size="small"
        variant="outlined"
        startIcon={<UploadIcon fontSize="small" />}
        sx={{ textTransform: "none", borderRadius: 1.5 }}
      >
        Upload YAML
        <input type="file" accept=".yml,.yaml" hidden onChange={onFile} />
      </Button>

      {error && (
        <Alert severity="warning" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>
      )}

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: "#111827" } }}>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
          <Box sx={{ flex: 1 }}>{filename || "Pick a test"}</Box>
          <IconButton size="small" onClick={() => setPickerOpen(false)}><CloseIcon fontSize="small" /></IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
            The uploaded YAML has multiple atomic_tests. Pick which test to load.
          </Typography>
          <Box sx={{ maxHeight: 320, overflowY: "auto" }}>
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
                <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    executor: {(t.raw?.executor?.name ?? "?")}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    platforms: {(t.raw?.supported_platforms || []).join(", ") || "?"}
                  </Typography>
                </Stack>
              </Box>
            ))}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}
