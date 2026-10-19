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
  Cpu, MemoryStick, HardDrive, AlertTriangle, Server, Search, Fingerprint, Bug, ShieldAlert, FlaskConical,
  Cloud, Globe, KeyRound, DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CLOUD_HOURLY_USD, type OsImageEntry, type OsImageCategory } from "@/config/os-images";

interface Deployment {
  deploymentId: string; imageId: string; name: string; vmName: string;
  status: "installing" | "running" | "stopped" | "error"; lastError?: string; createdAt: string;
  target?: string; provider?: string; region?: string; publicIp?: string; sshUser?: string;
  instanceType?: string; estCostUsdPerHr?: number;
}
interface SavedCred { id: string; provider: string; label: string }
type DeployTargetChoice = "local" | "aws" | "vps";
interface DeployPayload {
  target: DeployTargetChoice;
  cloud?: { provider: "aws"; region: string; instanceType: string; credentialId: string; allowedCidr: string; autoStopMinutes: number };
  vps?: { host: string; sshUser?: string; sshKeyCredentialId: string };
}

const CAT_ICON: Record<OsImageCategory, any> = {
  forensics: Fingerprint, osint: Search, "reverse-eng": Bug, pentest: Server, "red-team": ShieldAlert,
  "malware-analysis": FlaskConical,
};
const CAT_LABEL: Record<OsImageCategory, string> = {
  forensics: "Forensics / DFIR", osint: "OSINT", "reverse-eng": "Reverse Engineering", pentest: "Pentest", "red-team": "Red Team",
  "malware-analysis": "Malware / Behavior Analysis",
};

export default function OsImagesHub() {
  const [catalog, setCatalog] = useState<OsImageEntry[]>([]);
  const [items, setItems] = useState<Deployment[]>([]);
  const [localDeploy, setLocalDeploy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<OsImageEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creds, setCreds] = useState<SavedCred[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/os-images");
      const d = await r.json();
      setCatalog(d.catalog || []); setItems(d.items || []); setLocalDeploy(!!d.localDeployAvailable);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  const loadCreds = useCallback(async () => {
    try { const d = await (await fetch("/api/cloud-credentials")).json(); setCreds(d.items || []); } catch { /* ignore */ }
  }, []);
  useEffect(() => { load(); loadCreds(); }, [load, loadCreds]);
  useEffect(() => {
    if (!items.some((i) => i.status === "installing")) return;
    const iv = setInterval(load, 5000); return () => clearInterval(iv);
  }, [items, load]);

  const deploy = async (e: OsImageEntry, payload: DeployPayload) => {
    setBusy(e.id); setDetail(null);
    try { await fetch("/api/os-images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId: e.id, ...payload }) }); await load(); }
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
                    {d.target && d.target !== "local" && (
                      <span className="ml-2 text-[9px] uppercase px-1.5 py-0.5 rounded-full border border-accent/40 text-accent">
                        {d.target === "aws" ? `aws · ${d.region || ""}` : "vps"}{d.estCostUsdPerHr ? ` · ~$${d.estCostUsdPerHr.toFixed(2)}/hr` : ""}
                      </span>
                    )}
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {d.publicIp ? <>{d.sshUser || "ubuntu"}@{d.publicIp}</> : (d.vmName || "(pending)")}
                    </div>
                    {d.status === "running" && d.publicIp && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                        <a href={`http://${d.publicIp}:8000`} target="_blank" rel="noreferrer" className="text-accent hover:underline">CAPE UI</a>
                        <span className="font-mono">ssh -i &lt;key&gt; {d.sshUser || "ubuntu"}@{d.publicIp}</span>
                      </div>
                    )}
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
        <OsImageDetail entry={detail} localDeploy={localDeploy} creds={creds} busy={busy === detail.id} onClose={() => setDetail(null)} onDeploy={deploy} />
      )}
    </div>
  );
}

function OsImageDetail({ entry, localDeploy, creds, busy, onClose, onDeploy }: {
  entry: OsImageEntry; localDeploy: boolean; creds: SavedCred[]; busy: boolean; onClose: () => void;
  onDeploy: (e: OsImageEntry, payload: DeployPayload) => void;
}) {
  const localOk = entry.build.method === "vagrant-box" && entry.build.available;
  const supports = (t: DeployTargetChoice) => entry.targets.includes(t as any);
  const awsCreds = creds.filter((c) => c.provider === "aws");
  const sshCreds = creds.filter((c) => c.provider === "ssh");
  const awsSizing = entry.build.cloud?.aws;

  const [target, setTarget] = useState<DeployTargetChoice>(supports("local") && localOk ? "local" : supports("aws") ? "aws" : "vps");
  // AWS form
  const [region, setRegion] = useState("us-east-1");
  const [tier, setTier] = useState<"full" | "fallback">("full");
  const [awsCred, setAwsCred] = useState("");
  const [allowedCidr, setAllowedCidr] = useState("");
  const [autoStopHrs, setAutoStopHrs] = useState(4);
  // VPS form
  const [vpsHost, setVpsHost] = useState("");
  const [vpsUser, setVpsUser] = useState("root");
  const [vpsCred, setVpsCred] = useState("");

  // Prefill the allowed CIDR with the analyst's detected public IP /32.
  useEffect(() => {
    let on = true;
    fetch("https://api.ipify.org?format=json").then((r) => r.json()).then((d) => { if (on && d.ip) setAllowedCidr(`${d.ip}/32`); }).catch(() => {});
    return () => { on = false; };
  }, []);

  const instanceType = tier === "full" ? (awsSizing?.instanceType || "m7i.2xlarge") : (awsSizing?.fallbackInstanceType || "t3.2xlarge");
  const estHr = CLOUD_HOURLY_USD[instanceType];

  const submit = () => {
    if (target === "local") { onDeploy(entry, { target: "local" }); return; }
    if (target === "aws") {
      if (!awsCred || !allowedCidr) return;
      onDeploy(entry, { target: "aws", cloud: { provider: "aws", region, instanceType, credentialId: awsCred, allowedCidr, autoStopMinutes: Math.max(0, autoStopHrs) * 60 } });
      return;
    }
    if (!vpsHost || !vpsCred) return;
    onDeploy(entry, { target: "vps", vps: { host: vpsHost, sshUser: vpsUser || undefined, sshKeyCredentialId: vpsCred } });
  };

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

        {(localOk || supports("aws") || supports("vps")) ? (
          <div className="space-y-3">
            {/* Target chooser */}
            <div className="inline-flex rounded-lg border border-border bg-background/40 p-0.5 text-[11px]">
              {supports("local") && (
                <button onClick={() => setTarget("local")} className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md", target === "local" ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Server className="h-3 w-3" /> Local</button>
              )}
              {supports("aws") && (
                <button onClick={() => setTarget("aws")} className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md", target === "aws" ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Cloud className="h-3 w-3" /> AWS (cloud)</button>
              )}
              {supports("vps") && (
                <button onClick={() => setTarget("vps")} className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md", target === "vps" ? "bg-accent text-white" : "text-muted-foreground hover:text-foreground")}><Globe className="h-3 w-3" /> VPS</button>
              )}
            </div>

            {/* LOCAL */}
            {target === "local" && (
              <div className="space-y-2">
                {!localDeploy && <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> Local deploy runs on self-hosted installs only (PLATFORM_MODE=self-hosted).</div>}
                <p className="text-[11px] text-muted-foreground">Materialises <span className="font-mono">{entry.build.boxRef}</span> in VirtualBox on this host (first deploy downloads the box).</p>
                <button onClick={submit} disabled={!localDeploy || !localOk || busy} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Server className="h-3.5 w-3.5" />} Deploy locally
                </button>
              </div>
            )}

            {/* AWS */}
            {target === "aws" && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <label className="space-y-1"><span className="text-muted-foreground">AWS credential</span>
                    <select value={awsCred} onChange={(e) => setAwsCred(e.target.value)} className="w-full h-7 rounded border border-border bg-background px-2">
                      <option value="">— select —</option>
                      {awsCreds.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1"><span className="text-muted-foreground">Region</span>
                    <input value={region} onChange={(e) => setRegion(e.target.value)} className="w-full h-7 rounded border border-border bg-background px-2 font-mono" />
                  </label>
                </div>
                {awsCreds.length === 0 && <p className="text-[10px] text-warning inline-flex items-center gap-1"><KeyRound className="h-3 w-3" /> No AWS credentials saved — add one in Cloud Credentials first.</p>}
                <label className="block space-y-1 text-[11px]"><span className="text-muted-foreground">Instance tier</span>
                  <select value={tier} onChange={(e) => setTier(e.target.value as any)} className="w-full h-7 rounded border border-border bg-background px-2">
                    <option value="full">CAPE full — {awsSizing?.instanceType} (nested virt){CLOUD_HOURLY_USD[awsSizing?.instanceType || ""] ? ` · ~$${CLOUD_HOURLY_USD[awsSizing!.instanceType].toFixed(2)}/hr` : ""}</option>
                    <option value="fallback">Lighter — {awsSizing?.fallbackInstanceType} (Sysmon mode){CLOUD_HOURLY_USD[awsSizing?.fallbackInstanceType || ""] ? ` · ~$${CLOUD_HOURLY_USD[awsSizing!.fallbackInstanceType!].toFixed(2)}/hr` : ""}</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <label className="space-y-1"><span className="text-muted-foreground">Allowed IP (CIDR)</span>
                    <input value={allowedCidr} onChange={(e) => setAllowedCidr(e.target.value)} placeholder="your.ip/32" className="w-full h-7 rounded border border-border bg-background px-2 font-mono" />
                  </label>
                  <label className="space-y-1"><span className="text-muted-foreground">Auto-stop (hours)</span>
                    <input type="number" min={0} value={autoStopHrs} onChange={(e) => setAutoStopHrs(Number(e.target.value))} className="w-full h-7 rounded border border-border bg-background px-2" />
                  </label>
                </div>
                <div className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info flex items-center justify-between">
                  <span className="inline-flex items-center gap-1"><DollarSign className="h-3 w-3" /> Est. {estHr ? `~$${estHr.toFixed(2)}/hr (~$${(estHr * 24).toFixed(0)}/day)` : "see AWS pricing"}</span>
                  <span>SSH + ports locked to your IP</span>
                </div>
                <button onClick={submit} disabled={busy || !awsCred || !allowedCidr} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />} Deploy to AWS
                </button>
              </div>
            )}

            {/* VPS */}
            {target === "vps" && (
              <div className="space-y-2.5">
                <p className="text-[11px] text-muted-foreground">Provision an existing remote host you own over SSH (no infra created). Ensure it has ≥8 CPU / 16 GB / 200 GB and nested virt for full CAPE.</p>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <label className="space-y-1"><span className="text-muted-foreground">Host / IP</span>
                    <input value={vpsHost} onChange={(e) => setVpsHost(e.target.value)} placeholder="203.0.113.10" className="w-full h-7 rounded border border-border bg-background px-2 font-mono" />
                  </label>
                  <label className="space-y-1"><span className="text-muted-foreground">SSH user</span>
                    <input value={vpsUser} onChange={(e) => setVpsUser(e.target.value)} className="w-full h-7 rounded border border-border bg-background px-2 font-mono" />
                  </label>
                </div>
                <label className="block space-y-1 text-[11px]"><span className="text-muted-foreground">SSH key credential</span>
                  <select value={vpsCred} onChange={(e) => setVpsCred(e.target.value)} className="w-full h-7 rounded border border-border bg-background px-2">
                    <option value="">— select —</option>
                    {sshCreds.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                {sshCreds.length === 0 && <p className="text-[10px] text-warning inline-flex items-center gap-1"><KeyRound className="h-3 w-3" /> No SSH key saved — add a Cloud Credential with provider "ssh" (private key in the secret field).</p>}
                <button onClick={submit} disabled={busy || !vpsHost || !vpsCred} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />} Provision VPS
                </button>
              </div>
            )}
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
