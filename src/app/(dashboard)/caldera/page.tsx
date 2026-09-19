"use client";

/**
 * /caldera — focused console for the local managed Caldera C2.
 *
 * The server is installed once (built in the background) and only goes live when
 * you Start it, right here on the same host DetectOps runs on. Start it, open the
 * Caldera UI, enroll a beacon on this machine, and simulate — then Stop it to
 * free resources. Full multi-server management lives under Deploy → Fleet Simulation.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Radio, Play, Square, Loader2, ExternalLink, RefreshCw, Copy, Check, Eye, EyeOff,
  ShieldCheck, Rocket, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface C2Row { id: string; name: string; provider: string; mode: string; url: string; group: string; status: string; lastError: string; deploymentId: string | null }
interface Detail { webUrl: string; adminUser: string; adminPassword: string }

const RUNNING = (s: string) => s === "running" || s === "online";
const STATUS_TONE: Record<string, string> = {
  running: "text-success", online: "text-success", installed: "text-warning",
  stopped: "text-muted-foreground", installing: "text-info", starting: "text-info", error: "text-danger",
};

export default function CalderaConsolePage() {
  const [server, setServer] = useState<C2Row | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [beacons, setBeacons] = useState<any[] | null>(null);
  const [enroll, setEnroll] = useState("");
  const [enrollOs, setEnrollOs] = useState<"windows" | "linux" | "darwin">("windows");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState("");
  const [ifaces, setIfaces] = useState<Array<{ name: string; address: string; internal: boolean; hint: string }> | null>(null);
  const [chosenHost, setChosenHost] = useState("");
  const [choosingNet, setChoosingNet] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/c2");
      const d = await r.json();
      const managed = (d.items || []).find((s: C2Row) => s.provider === "caldera" && s.mode === "managed") || null;
      setServer(managed);
      if (managed) {
        const dr = await fetch(`/api/c2/${managed.id}`); const dd = await dr.json();
        setDetail({ webUrl: dd.webUrl, adminUser: dd.adminUser, adminPassword: dd.adminPassword });
        loadEnroll(managed.id, enrollOs);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [enrollOs]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!server || !["installing", "starting"].includes(server.status)) return;
    const iv = setInterval(load, 5000); return () => clearInterval(iv);
  }, [server, load]);

  const loadEnroll = async (id: string, os: typeof enrollOs) => {
    setEnrollOs(os);
    const r = await fetch(`/api/c2/${id}/enroll?os=${os}`); const d = await r.json(); setEnroll(d.command || "");
  };
  const openNetChooser = async () => {
    setChoosingNet(true);
    try { const r = await fetch("/api/c2/interfaces"); const d = await r.json(); setIfaces(d.interfaces || []); setChosenHost((d.interfaces || []).find((i: any) => !i.internal)?.address || ""); }
    catch { setIfaces([]); }
  };
  const lifecycle = async (action: "start" | "stop", advertiseHost?: string) => {
    if (!server) return;
    setBusy(action);
    try {
      await fetch(`/api/c2/${server.id}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, advertiseHost }) });
      setChoosingNet(false);
      await load();
    } finally { setBusy(null); }
  };
  const loadBeacons = async () => {
    if (!server) return;
    setBusy("beacons");
    try { const r = await fetch(`/api/c2/${server.id}/agents`); const d = await r.json(); setBeacons(d.beacons || []); }
    finally { setBusy(null); }
  };
  const copy = (text: string, key: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };
  // Reach Caldera on whatever host the operator is browsing DetectOps from
  // (Caldera binds 0.0.0.0), so the console is reachable on the same endpoint.
  const consoleUrl = () => {
    const stored = detail?.webUrl || server?.url || "";
    try { const u = new URL(stored); return typeof window !== "undefined" ? `${u.protocol}//${window.location.hostname}:${u.port || "8888"}` : stored; }
    catch { return stored; }
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2"><Radio className="h-6 w-6 text-accent" /> Caldera C2</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">A local MITRE Caldera server on this host. Installed once and started only when you need it — start it, open the console, enroll a beacon on this machine, and simulate.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
      </div>

      {!server ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center space-y-3">
          <Rocket className="h-8 w-8 text-accent mx-auto" />
          <p className="text-sm text-foreground font-medium">No local Caldera installed yet</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">Install one from Deploy → Fleet Simulation. It clones + builds Caldera in Docker on this host (once), then you can start/stop it here.</p>
          <Link href="/deploy?view=fleet" className="inline-flex items-center gap-1.5 text-xs h-9 px-3 rounded-md bg-accent text-white hover:bg-[#60a5fa]"><Rocket className="h-4 w-4" /> Go to Fleet Simulation</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status + lifecycle */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{server.name}</span>
              <span className={cn("text-xs font-bold uppercase", STATUS_TONE[server.status] || "text-muted-foreground")}>{server.status}</span>
              <div className="ml-auto flex items-center gap-2">
                {["installing", "starting"].includes(server.status) && <span className="inline-flex items-center gap-1 text-xs text-info"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {server.status}…</span>}
                {["installed", "stopped", "error"].includes(server.status) && server.deploymentId && !choosingNet && (
                  <button onClick={openNetChooser} disabled={busy === "start"} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md bg-success/90 text-white hover:bg-success disabled:opacity-50"><Play className="h-3.5 w-3.5" /> Start…</button>
                )}
                {RUNNING(server.status) && (
                  <>
                    <a href={consoleUrl()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md border border-accent/40 text-accent hover:bg-accent/10"><ExternalLink className="h-3.5 w-3.5" /> Open in new tab</a>
                    <button onClick={() => lifecycle("stop")} disabled={busy === "stop"} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md border border-border text-foreground hover:bg-card-hover disabled:opacity-50">{busy === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Stop</button>
                  </>
                )}
              </div>
            </div>
            {server.lastError && <div className="mt-2 text-[11px] text-danger">{server.lastError}</div>}
            {server.status === "installed" && !choosingNet && <div className="mt-2 text-[11px] text-muted-foreground">Built and ready. Click <span className="text-foreground font-medium">Start…</span> and choose which network to advertise to your beacons.</div>}

            {choosingNet && (
              <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-foreground">Choose the network beacons will reach this C2 on</p>
                {ifaces === null ? (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> detecting interfaces…</div>
                ) : (
                  <div className="space-y-1.5">
                    {ifaces.map((i) => (
                      <label key={i.name + i.address} className={cn("flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border cursor-pointer", chosenHost === i.address ? "border-accent bg-accent/10" : "border-border hover:bg-card-hover")}>
                        <input type="radio" name="c2net" checked={chosenHost === i.address} onChange={() => setChosenHost(i.address)} className="accent-[var(--accent)]" />
                        <span className="font-mono text-foreground">{i.address}</span>
                        <span className="text-muted-foreground">{i.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{i.hint}</span>
                      </label>
                    ))}
                    <p className="text-[10px] text-muted-foreground">Caldera listens on all interfaces (0.0.0.0); this is the address baked into the beacon enrollment command + console URL. Pick the net your target endpoints are on (e.g. the host-only/VM net).</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={() => lifecycle("start", chosenHost)} disabled={busy === "start" || !chosenHost} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded-md bg-success/90 text-white hover:bg-success disabled:opacity-50">{busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start on {chosenHost || "…"}</button>
                  <button onClick={() => setChoosingNet(false)} className="text-xs h-8 px-3 rounded-md border border-border text-muted-foreground">Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Embedded Caldera console (Caldera sets no X-Frame-Options, so it frames) */}
          {RUNNING(server.status) && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-semibold text-foreground">Caldera console</span>
                <span className="text-[10px] text-muted-foreground font-mono">{consoleUrl()}</span>
                <a href={consoleUrl()} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[10px] text-accent hover:underline"><ExternalLink className="h-3 w-3" /> open in new tab</a>
              </div>
              <iframe src={consoleUrl()} title="Caldera console" className="w-full h-[600px] bg-white" />
              <div className="px-4 py-1.5 text-[10px] text-muted-foreground border-t border-border">Sign in with the credentials below. If the frame stays blank (browser blocked it or DetectOps is on HTTPS while Caldera is HTTP), use “open in new tab”.</div>
            </div>
          )}

          {/* Login + URL (visible once running) */}
          {RUNNING(server.status) && detail && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-semibold text-foreground">Console access</p>
              <CredLine label="URL" value={detail.webUrl || server.url} copied={copied === "url"} onCopy={() => copy(detail.webUrl || server.url, "url")} mono />
              <CredLine label="User" value={detail.adminUser || "red"} copied={copied === "user"} onCopy={() => copy(detail.adminUser || "red", "user")} mono />
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground w-12">Pass</span>
                <code className="text-[11px] font-mono text-foreground">{showPw ? (detail.adminPassword || "—") : "••••••••••"}</code>
                <button onClick={() => setShowPw((v) => !v)} className="text-muted-foreground hover:text-foreground">{showPw ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}</button>
                <button onClick={() => copy(detail.adminPassword, "pw")} className="text-muted-foreground hover:text-foreground">{copied === "pw" ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}</button>
              </div>
            </div>
          )}

          {/* Beacon enrollment */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-foreground">Enroll a beacon (run on the target — including this host)</p>
              <div className="inline-flex rounded-md border border-border overflow-hidden ml-auto">
                {(["windows", "linux", "darwin"] as const).map((os) => (
                  <button key={os} onClick={() => server && loadEnroll(server.id, os)} className={cn("px-2 py-0.5 text-[10px] font-medium", enrollOs === os ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground")}>{os}</button>
                ))}
              </div>
              <button onClick={() => copy(enroll, "enroll")} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">{copied === "enroll" ? <><Check className="h-3 w-3 text-success" /> copied</> : <><Copy className="h-3 w-3" /> copy</>}</button>
            </div>
            <pre className="text-[10px] font-mono bg-background/60 border border-border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">{enroll || "…"}</pre>
            {!RUNNING(server.status) && <p className="text-[10px] text-warning flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Start the server first so the beacon can reach it.</p>}
            <button onClick={loadBeacons} disabled={busy === "beacons" || !RUNNING(server.status)} className="inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover disabled:opacity-50">{busy === "beacons" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Check beacons</button>
            {beacons && <div className="text-[11px] text-muted-foreground">{beacons.length} beacon(s) checked in{beacons.length ? `: ${beacons.map((b) => b.host || b.id).join(", ")}` : ""}.</div>}
          </div>

          {/* Two ways to simulate once a beacon is enrolled */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-semibold text-foreground">Simulate an attack</p>
            <p className="text-[11px] text-muted-foreground">Once a beacon is checked in, run techniques two ways:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <Link href="/campaign-designer" className="rounded-lg border border-accent/40 bg-accent/5 p-3 hover:bg-accent/10 transition-colors">
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Rocket className="h-4 w-4 text-accent" /> Campaign Designer</div>
                <p className="text-[11px] text-muted-foreground mt-1">Platform-driven: pick this C2 as the target, select techniques, run &amp; score detection — same flow as every other environment.</p>
              </Link>
              <a href={RUNNING(server.status) ? consoleUrl() : undefined} target="_blank" rel="noreferrer" className={cn("rounded-lg border p-3 transition-colors", RUNNING(server.status) ? "border-border hover:bg-card-hover" : "border-border opacity-60 pointer-events-none")}>
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground"><ExternalLink className="h-4 w-4 text-accent" /> Caldera UI</div>
                <p className="text-[11px] text-muted-foreground mt-1">Drive operations directly in Caldera: build adversaries, choose planners, and watch links execute in real time.</p>
              </a>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">Manage all C2 servers &amp; fleets under <Link href="/deploy?view=fleet" className="text-accent hover:underline">Deploy → Fleet Simulation</Link>.</p>
        </div>
      )}
    </div>
  );
}

function CredLine({ label, value, copied, onCopy, mono }: { label: string; value: string; copied: boolean; onCopy: () => void; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-12">{label}</span>
      <code className={cn("text-[11px] text-foreground truncate", mono && "font-mono")}>{value || "—"}</code>
      <button onClick={onCopy} className="text-muted-foreground hover:text-foreground ml-auto">{copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}</button>
    </div>
  );
}
