"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Plus, Server, Cloud, Cpu, GitBranch, Edit2, Trash2, Loader2, Inbox,
  CheckCircle2, AlertTriangle, Power, FileCode2, Activity, RefreshCw, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import EnvironmentForm, { type EnvKind } from "@/components/enterprise-use-cases/EnvironmentForm";

interface EnvRow {
  id: string;
  name: string;
  kind: string;
  templateRef?: string;
  cloudProvider?: string;
  shellMode?: string;
  description?: string;
  hostname?: string;
  port?: number;
  region?: string;
  sshUser?: string;
  hasAgentToken?: boolean;
  listenerHost?: string;
  listenerPort?: number;
  payloadRef?: string;
  enabled: boolean;
  lastSeenAt?: string | null;
  lastError?: string | null;
  createdAt: string;
}

const KIND_META: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  "our-template-deployed": { label: "Template",  Icon: Server,     color: "text-accent border-accent/40 bg-accent/10" },
  "user-cloud":             { label: "Cloud",    Icon: Cloud,      color: "text-info border-info/40 bg-info/10" },
  agent:                    { label: "Agent",    Icon: Cpu,        color: "text-warning border-warning/40 bg-warning/10" },
  shell:                    { label: "Shell",    Icon: GitBranch,  color: "text-danger border-danger/40 bg-danger/10" },
};

const KIND_TABS: Array<{ id: string; label: string }> = [
  { id: "",                       label: "All" },
  { id: "our-template-deployed",  label: "Template" },
  { id: "user-cloud",             label: "Cloud" },
  { id: "agent",                  label: "Agent (stub)" },
  { id: "shell",                  label: "Shell (stub)" },
];

export default function EnvironmentsPage() {
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [counts, setCounts] = useState<Array<{ kind: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [creating, setCreating] = useState<EnvKind | null>(null);
  const [editing, setEditing] = useState<EnvRow | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const params = kindFilter ? `?kind=${kindFilter}` : "";
      const r = await fetch(`/api/environment-targets${params}`);
      const data = await r.json();
      if (!r.ok) { setError(data.error || "load failed"); return; }
      setRows(data.items || []);
      setCounts(data.counts || []);
    } catch (err: any) {
      setError(err?.message || "load failed");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kindFilter]);

  const test = async (id: string) => {
    setTestingId(id);
    try {
      const r = await fetch(`/api/environment-targets/${id}/test`, { method: "POST" });
      const data = await r.json();
      if (r.ok) {
        alert(data.ok ? `OK · ${data.latencyMs}ms · ${data.message}` : `Failed: ${data.message}`);
      } else {
        alert(`Error: ${data.error || "probe failed"}`);
      }
      await load();
    } finally { setTestingId(null); }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete environment "${name}"? Existing runs that reference it will block deletion.`)) return;
    const r = await fetch(`/api/environment-targets/${id}`, { method: "DELETE" });
    const data = await r.json();
    if (!r.ok) { alert(`Cannot delete: ${data.error}`); return; }
    await load();
  };

  const toggle = async (row: EnvRow) => {
    await fetch(`/api/environment-targets/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !row.enabled }),
    });
    await load();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/detections/enterprise" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Enterprise Use Cases
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Server className="h-6 w-6 text-accent" />
            Environment Targets
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Four simulation patterns: <strong>our template</strong> (SAR / GOAD via SSH) · <strong>user cloud</strong> (Stratus) · <strong>agent</strong> (stub) · <strong>shell</strong> (stub).
            Scenarios are executed against these from the use-case Runs tab.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <button onClick={load} className="inline-flex items-center gap-1 text-[11px] h-8 px-2 rounded border border-border text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </button>
          <CreateMenu onPick={(k) => setCreating(k)} />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
        </div>
      )}

      <div className="border-b border-border flex items-center gap-1 overflow-x-auto">
        {KIND_TABS.map((t) => {
          const count = t.id ? counts.find((c) => c.kind === t.id)?.count || 0 : counts.reduce((a, c) => a + c.count, 0);
          return (
            <button
              key={t.id || "all"}
              onClick={() => setKindFilter(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap",
                kindFilter === t.id ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className={cn("font-mono px-1.5 rounded text-[10px]",
                kindFilter === t.id ? "bg-accent/15 text-accent" : "bg-muted/15 text-muted-foreground",
              )}>{count}</span>
            </button>
          );
        })}
      </div>

      {creating && (
        <EnvironmentForm
          draft={{ name: "", kind: creating, enabled: true }}
          onSaved={() => { setCreating(null); load(); }}
          onCancel={() => setCreating(null)}
        />
      )}
      {editing && (
        <EnvironmentForm
          draft={editing as any}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <h3 className="text-sm font-semibold text-foreground">No environments yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Create one environment per simulation target. The runner dispatches scenario steps to the right backend
            based on environment kind.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const meta = KIND_META[r.kind] || KIND_META["our-template-deployed"];
            const isStub = r.kind === "agent" || r.kind === "shell";
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-3">
                  <meta.Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", meta.color.split(" ")[0])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground truncate">{r.name}</h3>
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border", meta.color)}>{meta.label}</span>
                      {isStub && <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase border border-warning/40 bg-warning/10 text-warning">stub</span>}
                      {!r.enabled && <span className="rounded px-1.5 py-0.5 text-[10px] uppercase bg-muted/15 text-muted-foreground">disabled</span>}
                      {r.lastSeenAt && (
                        <span className="text-[10px] text-success inline-flex items-center gap-0.5">
                          <CheckCircle2 className="h-2.5 w-2.5" /> last seen {new Date(r.lastSeenAt).toLocaleString()}
                        </span>
                      )}
                      {r.lastError && (
                        <span className="text-[10px] text-danger inline-flex items-center gap-0.5" title={r.lastError}>
                          <AlertTriangle className="h-2.5 w-2.5" /> last error
                        </span>
                      )}
                    </div>
                    {r.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{r.description}</p>}
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                      {r.kind === "our-template-deployed" && (
                        <>
                          {r.templateRef && <span className="font-mono">template: {r.templateRef}</span>}
                          {r.hostname && <span className="font-mono">ssh {r.sshUser}@{r.hostname}:{r.port || 22}</span>}
                        </>
                      )}
                      {r.kind === "user-cloud" && (
                        <>
                          {r.cloudProvider && <span className="font-mono uppercase">{r.cloudProvider}</span>}
                          {r.region && <span className="font-mono">region: {r.region}</span>}
                        </>
                      )}
                      {r.kind === "agent" && (
                        <>
                          {r.hostname && <span className="font-mono">callback: {r.hostname}</span>}
                          {r.hasAgentToken && <span className="inline-flex items-center gap-0.5 text-success"><ShieldAlert className="h-2.5 w-2.5" /> token stored (encrypted)</span>}
                        </>
                      )}
                      {r.kind === "shell" && (
                        <>
                          {r.shellMode && <span className="font-mono uppercase">{r.shellMode}-shell</span>}
                          {r.listenerHost && <span className="font-mono">listener: {r.listenerHost}:{r.listenerPort}</span>}
                          {r.payloadRef && <span className="inline-flex items-center gap-0.5 text-success"><FileCode2 className="h-2.5 w-2.5" /> payload stored</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => test(r.id)}
                      disabled={testingId === r.id}
                      className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      {testingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                      Test
                    </button>
                    <button onClick={() => toggle(r)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
                      <Power className="h-3 w-3" /> {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
                      <Edit2 className="h-3 w-3" /> Edit
                    </button>
                    <button onClick={() => remove(r.id, r.name)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded text-danger hover:bg-danger/10">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateMenu({ onPick }: { onPick: (k: EnvKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-accent text-white hover:bg-[#60a5fa]"
      >
        <Plus className="h-3.5 w-3.5" /> New environment
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-72 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
            {(["our-template-deployed", "user-cloud", "agent", "shell"] as EnvKind[]).map((k) => {
              const m = KIND_META[k];
              return (
                <button
                  key={k}
                  onClick={() => { onPick(k); setOpen(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-card-hover border-b border-border last:border-0 flex items-start gap-2"
                >
                  <m.Icon className={cn("h-4 w-4 mt-0.5", m.color.split(" ")[0])} />
                  <div>
                    <div className="text-xs font-semibold text-foreground">{m.label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
