"use client";

import { useEffect, useState } from "react";
import {
  MessageSquare, Plus, Send, Loader2, Trash2, AlertTriangle, RefreshCw, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Comment {
  id: string;
  author: string;
  body: string;
  kind: string;
  runId: string | null;
  createdAt: string;
}

const KIND_LABELS: Array<{ id: string; label: string; color: string }> = [
  { id: "note",       label: "Note",       color: "border-border bg-muted/10 text-muted-foreground" },
  { id: "review",     label: "Review",     color: "border-info/40 bg-info/10 text-info" },
  { id: "tuning",     label: "Tuning",     color: "border-warning/40 bg-warning/10 text-warning" },
  { id: "hand-off",   label: "Hand-off",   color: "border-success/40 bg-success/10 text-success" },
  { id: "escalation", label: "Escalation", color: "border-danger/40 bg-danger/10 text-danger" },
];

interface Props {
  packId: string;
  runId?: string;                    // when set, scopes to a specific run
  showHeader?: boolean;
}

export default function CommentThread({ packId, runId, showHeader = true }: Props) {
  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("note");
  const [posting, setPosting] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const params = runId ? `?runId=${runId}` : "";
      const r = await fetch(`/api/enterprise-use-cases/${packId}/comments${params}`);
      const data = await r.json();
      if (!r.ok) { setError(data.error || "load failed"); return; }
      setItems(data.items || []);
    } catch (err: any) {
      setError(err?.message || "load failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [packId, runId]);

  const post = async () => {
    if (!body.trim()) return;
    setPosting(true); setError(null);
    try {
      const r = await fetch(`/api/enterprise-use-cases/${packId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, kind, runId }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "post failed"); return; }
      setItems([data, ...items]);
      setBody(""); setAdding(false);
    } catch (err: any) {
      setError(err?.message || "post failed");
    } finally { setPosting(false); }
  };

  const remove = async (cid: string) => {
    if (!confirm("Delete this comment?")) return;
    const r = await fetch(`/api/enterprise-use-cases/${packId}/comments/${cid}`, { method: "DELETE" });
    if (r.ok) setItems(items.filter((c) => c.id !== cid));
  };

  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2 flex-wrap">
          <MessageSquare className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">Comments</h3>
          <span className="text-[10px] text-muted-foreground">{items.length} note{items.length !== 1 ? "s" : ""}{runId && <> · scoped to run {runId.slice(0, 8)}</>}</span>
          <button onClick={() => setAdding(!adding)} className="ml-auto inline-flex items-center gap-1 h-7 px-2 text-[11px] rounded bg-accent text-white hover:bg-[#60a5fa]">
            <Plus className="h-3 w-3" /> {adding ? "Cancel" : "Add comment"}
          </button>
          <button onClick={load} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}

      {adding && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="flex items-center gap-1">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Kind:</span>
            <div className="inline-flex rounded border border-border overflow-hidden">
              {KIND_LABELS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={cn(
                    "px-2 py-1 text-[10px] font-medium uppercase",
                    kind === k.id ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Add a note (markdown ok)"
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setAdding(false); setBody(""); }} className="text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button onClick={post} disabled={posting || !body.trim()} className="inline-flex items-center gap-1 text-[11px] h-7 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
              {posting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Post comment
            </button>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-6 text-center">
          <MessageSquare className="h-6 w-6 mx-auto mb-2 text-accent opacity-70" />
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((c) => {
            const meta = KIND_LABELS.find((k) => k.id === c.kind) || KIND_LABELS[0];
            return (
              <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase", meta.color)}>{meta.label}</span>
                  <span className="font-mono text-muted-foreground">{c.author}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                  {c.runId && <span className="font-mono text-[10px] text-muted-foreground">run {c.runId.slice(0, 8)}</span>}
                  <button onClick={() => remove(c.id)} className="ml-auto inline-flex items-center gap-1 text-[11px] text-danger hover:bg-danger/10 px-1 py-0.5 rounded">
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
                <div className="mt-1.5 text-xs text-foreground whitespace-pre-wrap break-words">{c.body}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
