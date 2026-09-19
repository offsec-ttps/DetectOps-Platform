"use client";
/**
 * Empty-state for the YAML preview pane — restyled to match the wider
 * DetectOps card aesthetic (accent-blue + flat panels) instead of upstream
 * atomicgen.io's pink/orange theme.
 */

import { Box, Paper, Typography, Stack } from "@mui/material";
import FileCodeIcon from "@mui/icons-material/CodeRounded";
import SparklesIcon from "@mui/icons-material/AutoAwesomeRounded";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooksRounded";
import EditNoteIcon from "@mui/icons-material/EditNoteRounded";

interface Step {
  icon: React.ReactNode;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: <SparklesIcon sx={{ fontSize: 16 }} />,
    title: "Describe a test in plain English",
    body: "Use the AI bar above — type what you want, refine until it fits.",
  },
  {
    icon: <LibraryBooksIcon sx={{ fontSize: 16 }} />,
    title: "Browse existing atomic-red-team tests",
    body: "Load any T-ID and adapt it to your environment.",
  },
  {
    icon: <EditNoteIcon sx={{ fontSize: 16 }} />,
    title: "Author from scratch",
    body: "Fill the form below; YAML appears here as you type.",
  },
];

export default function YamlEmptyState() {
  return (
    <Box sx={{
      display: "flex", flexDirection: "column", alignItems: "stretch",
      py: 4, px: { xs: 1.5, sm: 2.5 },
      minHeight: 360,
    }}>
      {/* Title block */}
      <Stack alignItems="center" spacing={1} sx={{ mb: 4 }}>
        <Box sx={{
          width: 44, height: 44, borderRadius: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(59,130,246,0.10)",
          border: "1px solid rgba(59,130,246,0.30)",
          color: "primary.main",
        }}>
          <FileCodeIcon sx={{ fontSize: 22 }} />
        </Box>
        <Typography variant="overline" sx={{
          letterSpacing: 2, fontWeight: 700, color: "text.secondary",
          fontSize: 10, lineHeight: 1,
        }}>
          GET STARTED
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "text.primary", fontSize: 16 }}>
          Author Atomic Red Team tests
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", maxWidth: 360, textAlign: "center" }}>
          The YAML for the active tab appears here as you fill in the form.
        </Typography>
      </Stack>

      {/* Steps */}
      <Stack spacing={1.25} sx={{ width: "100%", maxWidth: 420, mx: "auto" }}>
        {STEPS.map((s, i) => (
          <Paper
            key={i}
            variant="outlined"
            sx={{
              display: "flex", gap: 1.5, p: 1.5, alignItems: "flex-start",
              borderRadius: 1.5,
              borderColor: "rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.02)",
              transition: "border-color 120ms, background 120ms",
              "&:hover": {
                borderColor: "rgba(59,130,246,0.30)",
                background: "rgba(59,130,246,0.04)",
              },
            }}
          >
            <Box sx={{
              width: 26, height: 26, borderRadius: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(59,130,246,0.10)",
              border: "1px solid rgba(59,130,246,0.30)",
              color: "primary.main",
              flexShrink: 0,
            }}>
              {s.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" alignItems="baseline" spacing={1}>
                <Typography variant="caption" sx={{
                  fontFamily: "JetBrains Mono, monospace", fontSize: 10,
                  color: "text.disabled",
                }}>
                  {String(i + 1).padStart(2, "0")}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary", fontSize: 13 }}>
                  {s.title}
                </Typography>
              </Stack>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }}>
                {s.body}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
