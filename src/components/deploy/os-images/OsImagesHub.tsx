"use client";

/**
 * Analyst VMs / OS Images hub (Deploy → Analyst VMs). A catalog of purpose-built
 * security workstations (forensics / OSINT / reverse-eng / pentest / red-team)
 * plus the user's deployed VMs with start/stop/delete. Local Vagrant deploy is
 * the wired path; cloud/VPS + non-boxed images are template-only for now.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Monitor, Loader2, RefreshCw, Play, Square, Trash2, ExternalLink, BookOpen,
  Cpu, MemoryStick, HardDrive, AlertTriangle, Server, Search, Fingerprint, Bug, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OsImageEntry, OsImageCategory } from "@/config/os-images";

interface Deployment {
  deploymentId: string; imageId: string; name: string; vmName: string;
  status: "installing" | "running" | "stopped" | "error"; lastError?: string; createdAt: string;
}

const CAT_ICON: Record<OsImageCategory, any> = {
  forensics: Fingerprint, osint: Search, "reverse-eng": Bug, pentest: Server, "red-team": ShieldAlert,
};
const CAT_LABEL: Record<OsImageCategory, string> = {
  forensics: "Forensics / DFIR", osint: "OSINT", "reverse-eng": "Reverse Engineering", pentest: "Pentest", "red-team": "Red Team",
};

export default function OsImagesHub() {
  const [catalog, setCatalog] = useState<OsImageEntry[]>([]);
  const [items, setItems] = useState<Deployment[]>([]);
  const [localDeploy, setLocalDeploy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<OsImageEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/os-images");
      const d = await r.json();
      setCatalog(d.catalog || []); setItems(d.items || []); setLocalDeploy(!!d.localDeployAvailable);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!items.some((i) => i.status === "installing")) return;
    const iv = setInterval(load, 5000); return () => clearInterval(iv);
  }, [items, load]);

  const deploy = async (e: OsImageEntry) => {
    setBusy(e.id); setDetail(null);
    try { await fetch("/api/os-images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId: e.id }) }); await load(); }
    finally { setBusy(null); }
  };
  const lifecycle = async (dep: Deployment, action: "start" | "stop") => {
    setBusy(dep.deploymentId);
    try { await fetch(`/api/os-images/${dep.deploymentId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); await load(); }
    finally { setBusy(null); }
  };
  const del = async (dep: Deployment) => {
    setBusy(dep.deploymentId);
    try { await fetch(`/api/os-images/${dep.deploymentId}`, { method: "DELETE" }); await load(); }
    finally { setBusy(null); }
  };

  const cats = Array.from(new Set(catalog.map((e) => e.category)));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Monitor className="h-5 w-5 text-accent" /> Analyst VMs / OS Images</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
          Spin up a purpose-built workstation on demand — forensics, OSINT, reverse-engineering, or an authorized-pentest box.
          Deployed locally from public upstream images; cloud (AWS/Azure/GCP) builds into your own account are coming soon.
        </p>
      </div>

      {/* Deployed VMs */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Your analyst VMs</p>
          <button onClick={load} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"><RefreshCw className="h-3 w-3" /> Refresh</button>
        </div>
        {loading ? (
          <div className="py-4 flex items-center gap-2 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/30 p-6 text-center text-xs text-muted-foreground">No analyst VMs yet. Deploy one from the catalog below.</div>
        ) : (
          <div className="space-y-2">
            {items.map((d) => {
              const running = d.status === "running";
              return (
                <div key={d.deploymentId} className="rounded-xl border border-border bg-card px-4 py-2.5 flex items-center gap-3 flex-wrap">
                  <span className={cn("w-2 h-2 rounded-full", running ? "bg-success" : d.status === "installing" ? "bg-info animate-pulse" : d.status === "error" ? "bg-danger" : "bg-muted")} />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-foreground">{d.name}</span>
                    <span className="ml-2 text-[10px] uppercase font-bold text-muted-foreground">{d.status}</span>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">{d.vmName || "(pending)"}</div>
                    {d.status === "error" && d.lastError && <div className="text-[10px] text-danger mt-0.5">{d.lastError}</div>}
                  </div>
                  {d.status === "installing" && <span className="inline-flex items-center gap-1 text-[11px] text-info"><Loader2 className="h-3 w-3 animate-spin" /> installing…</span>}
                  {(d.status === "stopped" || d.status === "error") && d.vmName && (
                    <button onClick={() => lifecycle(d, "start")} disabled={busy === d.deploymentId} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded bg-success/90 text-white hover:bg-success disabled:opacity-50">
                      {busy === d.deploymentId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start
                    </button>
                  )}
                  {running && (
                    <button onClick={() => lifecycle(d, "stop")} disabled={busy === d.deploymentId} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">
                      {busy === d.deploymentId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />} Stop
                    </button>
                  )}
                  <button onClick={() => del(d)} disabled={busy === d.deploymentId} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded text-danger hover:bg-danger/10 disabled:opacity-50"><Trash2 className="h-3 w-3" /> Delete</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Catalog grouped by category */}
      {cats.map((cat) => {
        const Icon = CAT_ICON[cat] || Monitor;
        return (
          <section key={cat} className="space-y-2">
            <p className="text-sm font-medium text-foreground inline-flex items-center gap-1.5"><Icon className="h-4 w-4 text-accent" /> {CAT_LABEL[cat] || cat}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalog.filter((e) => e.category === cat).map((e) => (
                <button key={e.id} onClick={() => setDetail(e)} className="text-left rounded-xl border border-border bg-card p-4 flex flex-col hover:border-accent/40 hover:bg-card-hover transition-colors">
                  <div className="flex items-center justify-between">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-muted/10", e.build.available ? "text-accent" : "text-muted-foreground")}><Icon className="h-5 w-5" /></div>
                    <span className={cn("text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border", e.build.available ? "border-success/40 text-success" : "border-border text-muted-foreground")}>
                      {e.build.available ? "Deploy local" : "Guided · soon"}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground mt-3">{e.name}</h4>
                  <p className="text-[10px] text-muted-foreground">{e.baseOs}</p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground line-clamp-3 flex-1">{e.description}</p>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {detail && (
        <OsImageDetail entry={detail} localDeploy={localDeploy} busy={busy === detail.id} onClose={() => setDetail(null)} onDeploy={deploy} />
      )}
    </div>
  );
}

function OsImageDetail({ entry, localDeploy, busy, onClose, onDeploy }: {
  entry: OsImageEntry; localDeploy: boolean; busy: boolean; onClose: () => void; onDeploy: (e: OsImageEntry) => void;
}) {
  const deployable = entry.build.method === "vagrant-box" && entry.build.available;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">{entry.name}</h3>
            <p className="text-[11px] text-muted-foreground">{entry.baseOs} · {CAT_LABEL[entry.category]}</p>
          </div>
          <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline shrink-0"><BookOpen className="h-3 w-3" /> Docs <ExternalLink className="h-3 w-3" /></a>
        </div>
        <p className="text-xs text-muted-foreground">{entry.description}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {entry.tools && entry.tools.length > 0 && (
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <p className="text-[11px] font-semibold text-foreground mb-1.5">Preinstalled tooling</p>
              <div className="flex flex-wrap gap-1">
                {entry.tools.map((t) => <span key={t} className="text-[10px] rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground">{t}</span>)}
              </div>
            </div>
          )}
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <p className="text-[11px] font-semibold text-foreground mb-1.5">Resources</p>
            <div className="grid grid-cols-3 gap-y-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Cpu className="h-3 w-3" /> {entry.resources.cpus} vCPU</span>
              <span className="inline-flex items-center gap-1.5"><MemoryStick className="h-3 w-3" /> {(entry.resources.memoryMB / 1024).toFixed(0)} GB</span>
              <span className="inline-flex items-center gap-1.5"><HardDrive className="h-3 w-3" /> {entry.resources.diskGB} GB</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Targets: {entry.targets.join(" · ")}</p>
          </div>
        </div>

        {deployable ? (
          <div className="space-y-2">
            {!localDeploy && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Local deploy runs on self-hosted installs only (PLATFORM_MODE=self-hosted).
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Materialises the official <span className="font-mono">{entry.build.boxRef}</span> Vagrant box in VirtualBox on this host. First deploy downloads the box (can be several GB).</p>
            <button onClick={() => onDeploy(entry)} disabled={!localDeploy || busy} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Server className="h-3.5 w-3.5" />} Deploy locally
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info flex items-start gap-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Automated deploy for {entry.name} is coming soon. Build it in your lab using the steps below and the official docs.
            </div>
            {entry.build.guidedSteps && (
              <ol className="space-y-1.5">
                {entry.build.guidedSteps.map((s, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground flex gap-2">
                    <span className="shrink-0 h-4 w-4 rounded-full bg-accent/15 text-accent text-[9px] font-bold inline-flex items-center justify-center">{i + 1}</span>{s}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
