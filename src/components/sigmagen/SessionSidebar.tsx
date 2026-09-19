"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { History, Plus, MessageSquare, Trash2, Pin, PanelRightClose, Clock } from "lucide-react";

export interface SessionSummary {
  id: string; title: string; status: string; messageCount: number; runCount: number; updatedAt: string;
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime(); const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Right-side history rail. Collapsed to an icon strip; expands on hover, and
 * can be pinned open with a click. Lists every SigmaGen session, starts a new
 * chat, resumes a previous one, or deletes.
 */
export function SessionSidebar({
  sessions, activeId, onSelect, onNew, onDelete,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = hovered || pinned;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "shrink-0 border-l border-border bg-card/60 backdrop-blur transition-all duration-200 flex flex-col",
        expanded ? "w-72" : "w-12",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 h-12">
        <button onClick={() => setPinned((p) => !p)} title={pinned ? "Unpin" : "Pin open"} className="text-muted-foreground hover:text-foreground">
          {expanded ? (pinned ? <PanelRightClose className="h-4 w-4" /> : <Pin className="h-4 w-4" />) : <History className="h-4 w-4" />}
        </button>
        {expanded && <span className="flex-1 text-xs font-semibold text-foreground">History</span>}
        {expanded && (
          <button onClick={onNew} title="New chat" className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent/90">
            <Plus className="h-3 w-3" /> New
          </button>
        )}
      </div>

      {/* Collapsed: new-chat icon */}
      {!expanded && (
        <button onClick={onNew} title="New chat" className="mx-auto mt-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-card-hover hover:text-accent">
          <Plus className="h-4 w-4" />
        </button>
      )}

      {/* Session list */}
      {expanded ? (
        <div className="flex-1 overflow-y-auto py-1">
          {sessions.length === 0 && <p className="px-3 py-4 text-[11px] text-muted-foreground">No sessions yet. Start an analysis — it’s saved here automatically.</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                "group mx-1.5 my-0.5 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 transition-colors",
                s.id === activeId ? "bg-accent/10 border border-accent/30" : "hover:bg-card-hover border border-transparent",
              )}
              onClick={() => onSelect(s.id)}
            >
              <MessageSquare className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.id === activeId ? "text-accent" : "text-muted")} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-foreground">{s.title || "Untitled session"}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                  <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{relTime(s.updatedAt)}</span>
                  <span>{s.runCount} run{s.runCount === 1 ? "" : "s"}</span>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                title="Delete session"
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden py-2">
          {sessions.slice(0, 8).map((s) => (
            <button key={s.id} onClick={() => onSelect(s.id)} title={s.title}
              className={cn("mx-auto my-1 flex h-7 w-7 items-center justify-center rounded-lg", s.id === activeId ? "bg-accent/15 text-accent" : "text-muted hover:bg-card-hover hover:text-foreground")}>
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
