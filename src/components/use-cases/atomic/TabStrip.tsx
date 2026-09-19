"use client";
/**
 * Tab strip for the ART builder — lets users work on several tests at once
 * (separate per-tab form state). Behaviour:
 *
 *   - Click a tab to switch.
 *   - "+" appends a fresh blank tab.
 *   - Hover a tab to reveal the close (×). Closing the last tab spawns a
 *     blank one so the editor is never empty.
 *   - A small dot to the left of the label indicates unsaved dirty state.
 *   - When `tabs.length === 1`, the close button is hidden on that tab to
 *     prevent accidental destruction; the "+" still works.
 */

import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import CheckIcon from "@mui/icons-material/Check";

export interface TabMeta {
  id: string;
  label: string;
  /** Short hint shown under the label when the tab is active (e.g. T1003.001) */
  hint?: string;
  dirty: boolean;
  saved: boolean;
}

interface Props {
  tabs: TabMeta[];
  activeId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
}

export default function TabStrip({ tabs, activeId, onSwitch, onAdd, onClose }: Props) {
  return (
    <Box sx={{
      display: "flex", alignItems: "stretch", gap: 0.5,
      borderBottom: "1px solid", borderColor: "divider",
      pb: 0.5, overflowX: "auto",
      // hide native scrollbar visual on most platforms
      scrollbarWidth: "thin",
      "&::-webkit-scrollbar": { height: 6 },
      "&::-webkit-scrollbar-thumb": { background: "rgba(255,255,255,0.10)", borderRadius: 3 },
    }}>
      {tabs.map((t) => {
        const active = t.id === activeId;
        const closeable = tabs.length > 1;
        return (
          <Box
            key={t.id}
            onClick={() => onSwitch(t.id)}
            sx={{
              position: "relative",
              minWidth: 168, maxWidth: 240,
              px: 1.5, py: 1, cursor: "pointer",
              borderRadius: "10px 10px 0 0",
              border: "1px solid",
              borderColor: active ? "primary.main" : "transparent",
              borderBottom: active ? "1px solid #111827" : "1px solid transparent",
              background: active
                ? "linear-gradient(180deg, rgba(59,130,246,0.10), rgba(59,130,246,0.02))"
                : "transparent",
              transition: "background 120ms, border-color 120ms",
              "&:hover": {
                background: active
                  ? "linear-gradient(180deg, rgba(59,130,246,0.14), rgba(59,130,246,0.04))"
                  : "rgba(255,255,255,0.04)",
                "& .tab-close": { opacity: 1 },
              },
              "&:hover .tab-status": { opacity: closeable ? 0 : 1 },
              display: "flex", flexDirection: "column", gap: 0.25,
              flexShrink: 0,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
              <Box className="tab-status" sx={{ display: "flex", alignItems: "center", opacity: 1, transition: "opacity 120ms" }}>
                {t.dirty
                  ? <FiberManualRecordIcon sx={{ fontSize: 8, color: "warning.main" }} />
                  : t.saved
                    ? <CheckIcon sx={{ fontSize: 12, color: "success.main" }} />
                    : <FiberManualRecordIcon sx={{ fontSize: 8, color: "text.disabled" }} />
                }
              </Box>
              <Typography variant="body2" sx={{
                fontSize: 12.5, fontWeight: active ? 600 : 500,
                color: active ? "text.primary" : "text.secondary",
                whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden",
                flex: 1,
              }}>
                {t.label}
              </Typography>
              {closeable && (
                <IconButton
                  size="small"
                  className="tab-close"
                  onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                  sx={{
                    p: 0.25, ml: 0.25, opacity: active ? 0.6 : 0,
                    transition: "opacity 120ms",
                    "&:hover": { background: "rgba(255,255,255,0.08)", opacity: 1 },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 13 }} />
                </IconButton>
              )}
            </Box>
            {active && t.hint && (
              <Typography variant="caption" sx={{ fontSize: 10, color: "text.disabled", fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t.hint}
              </Typography>
            )}
          </Box>
        );
      })}
      <Tooltip title="New tab">
        <IconButton
          size="small"
          onClick={onAdd}
          sx={{
            alignSelf: "center", ml: 0.5,
            border: "1px dashed", borderColor: "divider",
            "&:hover": { borderColor: "primary.main", background: "rgba(59,130,246,0.06)" },
          }}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
