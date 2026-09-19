"use client";

/**
 * Cloud tab for the Detection Eng Lab.
 *
 * Consumes the SAR controller's REST API (via our Next.js proxy) and lets the
 * user list templates, build a range end-to-end with WireGuard handoff, watch
 * phase progress, drill into a running-range detail view, and destroy ranges —
 * all without leaving localhost:3000.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Cloud, Copy, Download, ExternalLink,
  Info, Loader2, Play, PowerOff, RefreshCw, Rocket, Server, Shield, Trash2, XCircle,
} from "lucide-react";
import {
  sarAbortRange, sarBuildRange, sarCloudFields, sarDestroyRange,
  sarHealth, sarListRanges, sarListTemplates, sarProvidersCheck,
  sarRangeStatus, sarSuggestedIp,
} from "@/lib/sar-client";
import type {
  SarArchitectureServer, SarCloudFieldsResponse, SarOperationStatus,
  SarProvider, SarProviderAvailability, SarTemplateInfo,
} from "@/types/sar";
import { isSarTerminal } from "@/types/sar";
import HostInfoHeader from "./HostInfoHeader";
import ConnectivityHealthStrip from "./ConnectivityHealthStrip";
import ProviderGroupedGrid from "./ProviderGroupedGrid";
import RunningRangeDetail from "./RunningRangeDetail";
import CreateTemplateForm from "./CreateTemplateForm";
import { ProviderIcon, durationText, fmtStatus, statusStyle } from "./_shared";
import TerminalPanel from "./TerminalPanel";
import { cn } from "@/lib/utils";

// ── SAR unavailable banner ──

function SarUnavailableBanner({ reason, onJumpToOnPrem }: { reason: string; onJumpToOnPrem: () => void }) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-6 flex items-start gap-4">
      <Shield className="h-6 w-6 text-warning flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground mb-1">SAR controller not reachable</h3>
        <p className="text-xs text-muted-foreground mb-3">{reason}</p>
        <button
          onClick={onJumpToOnPrem}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
        >
          <Rocket className="h-3 w-3" /> Deploy "SAR + Onprem Docker" on the On-Premises tab
        </button>
      </div>
    </div>
  );
}

// ── Template detail + build form ──

function ArchitectureTable({ servers }: { servers: SarArchitectureServer[] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-background/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">OS</th>
            <th className="px-3 py-2 text-left font-medium">Instance</th>
            <th className="px-3 py-2 text-left font-medium">Private IP</th>
            <th className="px-3 py-2 text-left font-medium">Roles</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((s) => {
            // SAR convention: lab hosts live on 10.0.2.x. Render the computed IP
            // so users can actually ping / RDP / SSH without math.
            const ip = typeof s.ip_last_octet === "number" ? `10.0.2.${s.ip_last_octet}` : null;
            return (
              <tr key={s.name} className="border-t border-border/40">
                <td className="px-3 py-2 font-mono text-foreground">{s.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.os_type || "—"}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{s.instance_type || "—"}</td>
                <td className="px-3 py-2 font-mono text-foreground">{ip || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{(s.roles || []).join(", ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CloudTemplateDetail({
  tpl, onBack, onBuild, error, building,
}: {
  tpl: SarTemplateInfo;
  onBack: () => void;
  onBuild: (opts: { ip_whitelist: string; password: string; cloud: Record<string, string> }) => void;
  error: string | null;
  building: boolean;
}) {
  const [ipWhitelist, setIpWhitelist] = useState("");
  const [password, setPassword] = useState("changeme123!");
  const [cloudFields, setCloudFields] = useState<SarCloudFieldsResponse | null>(null);
  const [cloudValues, setCloudValues] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    sarSuggestedIp().then((r) => { if (!cancelled && !ipWhitelist) setIpWhitelist(r.cidr); }).catch(() => {});
    sarCloudFields(tpl.provider).then((r) => {
      if (cancelled) return;
      setCloudFields(r);
      const defaults: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.fields)) {
        defaults[k] = v.default || (v.options && v.options[0]) || "";
      }
      setCloudValues(defaults);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tpl.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <ProviderIcon provider={tpl.provider} />
          <h3 className="text-sm font-semibold text-foreground">{tpl.name.replace(/\.yml$/, "")}</h3>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{tpl.description || "—"}</p>

      {tpl.architecture && tpl.architecture.length > 0 && <ArchitectureTable servers={tpl.architecture} />}

      <div className="rounded-lg border border-border bg-background/30 p-4 space-y-3">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Rocket className="h-3.5 w-3.5 text-accent" /> Build configuration
        </h4>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">IP whitelist (CIDR)</span>
            <input
              type="text" value={ipWhitelist} onChange={(e) => setIpWhitelist(e.target.value)}
              placeholder="1.2.3.4/32 or 0.0.0.0/0"
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground"
            />
            <span className="text-[10px] text-muted-foreground">Pre-filled from your public IP.</span>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Attack range password</span>
            <input
              type="text" value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground"
            />
            <span className="text-[10px] text-muted-foreground">Admin password for Splunk + WinRM sessions in the range.</span>
          </label>
        </div>

        {cloudFields && Object.keys(cloudFields.fields).length > 0 && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/30">
            {Object.entries(cloudFields.fields).map(([key, field]) => (
              <label key={key} className="block">
                <span className="text-[11px] font-medium text-muted-foreground">{field.label}{field.required ? " *" : ""}</span>
                {field.type === "select" && field.options ? (
                  <select
                    value={cloudValues[key] || ""}
                    onChange={(e) => setCloudValues({ ...cloudValues, [key]: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                  >
                    {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    value={cloudValues[key] || ""}
                    onChange={(e) => setCloudValues({ ...cloudValues, [key]: e.target.value })}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground"
                  />
                )}
              </label>
            ))}
          </div>
        )}

        {error && (
          <p className="text-[11px] font-mono text-danger bg-danger/5 border border-danger/20 rounded px-2 py-1">
            {error}
          </p>
        )}

        <button
          onClick={() => onBuild({ ip_whitelist: ipWhitelist, password, cloud: cloudValues })}
          disabled={building}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent/10 border border-accent/30 px-4 py-2.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-40"
        >
          {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {building ? "Starting build…" : `Build ${tpl.provider.toUpperCase()} range`}
        </button>
      </div>
    </div>
  );
}

// ── Build progress (phase timeline + WG handoff) ──

const PHASE_ORDER = [
  { status: "queued",        label: "Queued",            desc: "Waiting to start" },
  { status: "build_vpn",     label: "Build VPN",         desc: "Terraform provisions VPC + WireGuard router" },
  { status: "wait_for_vpn",  label: "Connect WireGuard", desc: "Waiting for you to import the config + connect" },
  { status: "build_lab",     label: "Build Lab",         desc: "Ansible installs Splunk / Windows / Kali on lab hosts" },
  { status: "running",       label: "Running",           desc: "Range is live — reach Splunk via the tunnel" },
] as const;

function CloudBuildProgress({
  state, onContinue, onAbort,
}: {
  state: SarOperationStatus;
  onContinue: () => void;
  onAbort: () => void;
}) {
  const currentIdx = PHASE_ORDER.findIndex((p) => p.status === state.status);
  const failed = state.status === "failed" || state.status === "error";

  // The lab phase drives ansible at the range's PRIVATE IPs, which only route
  // over the tunnel. Continuing before it is really up wastes the whole build,
  // so verify server-side instead of trusting the click.
  const [vpnCheck, setVpnCheck] = useState<
    { checking: boolean; connected: boolean | null; reason: string | null }
  >({ checking: false, connected: null, reason: null });

  const verifyThenContinue = async () => {
    if (!state.attack_range_id) return;
    setVpnCheck({ checking: true, connected: null, reason: null });
    try {
      const res = await fetch(`/api/detection-lab/cloud/vpn-check/${state.attack_range_id}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.connected) {
        setVpnCheck({ checking: false, connected: false, reason: data.reason });
        return;
      }
      setVpnCheck({ checking: false, connected: true, reason: null });
      onContinue();
    } catch {
      setVpnCheck({
        checking: false,
        connected: false,
        reason: "Could not verify the tunnel. Confirm WireGuard is active, then retry.",
      });
    }
  };

  const copyToClipboard = async (txt: string) => {
    try { await navigator.clipboard.writeText(txt); } catch { /* ignore */ }
  };
  const download = (txt: string, filename: string) => {
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold text-foreground">
            Building {state.template_name?.replace(/\.yml$/, "") || "range"}
          </span>
          <code className="text-[10px] text-muted-foreground bg-background rounded px-1">
            {state.attack_range_id?.slice(0, 8)}
          </code>
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", statusStyle(state.status))}>
            {fmtStatus(state.status)}
          </span>
        </div>
        {!failed && state.status !== "running" && (
          <button
            onClick={onAbort}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-danger border border-border rounded px-2 py-1"
          >
            <PowerOff className="h-3 w-3" /> Abort
          </button>
        )}
      </div>

      <div className="space-y-2">
        {PHASE_ORDER.map((p, i) => {
          const status: "done" | "active" | "pending" | "failed" =
            failed && i === currentIdx ? "failed" :
            i < currentIdx ? "done" :
            i === currentIdx ? "active" : "pending";
          return (
            <div key={p.status} className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2",
              status === "done"    && "border-success/30 bg-success/5",
              status === "active"  && "border-accent/40 bg-accent/5",
              status === "failed"  && "border-danger/30 bg-danger/5",
              status === "pending" && "border-border bg-card",
            )}>
              <div className="w-5 h-5 flex items-center justify-center">
                {status === "done" && <CheckCircle2 className="h-4 w-4 text-success" />}
                {status === "active" && <Loader2 className="h-4 w-4 text-accent animate-spin" />}
                {status === "failed" && <XCircle className="h-4 w-4 text-danger" />}
                {status === "pending" && <span className="h-2 w-2 rounded-full bg-muted" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground">{p.label}</div>
                <div className="text-[11px] text-muted-foreground">{p.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {state.status === "wait_for_vpn" && state.wireguard_config && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-warning" />
            <span className="text-xs font-semibold text-foreground">Connect WireGuard to continue</span>
          </div>
          <p className="text-xs text-muted-foreground">
            1. Copy or download the config. 2. Import it into your WireGuard client and activate. 3. Click "I'm connected".
          </p>
          <pre className="text-[11px] font-mono bg-background border border-border rounded p-3 overflow-x-auto max-h-60 overflow-y-auto text-muted-foreground">
{state.wireguard_config}
          </pre>
          <div className="flex items-center gap-2">
            <button onClick={() => copyToClipboard(state.wireguard_config!)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1">
              <Copy className="h-3 w-3" /> Copy
            </button>
            <button onClick={() => download(state.wireguard_config!, `${state.attack_range_id?.slice(0, 8)}.conf`)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1">
              <Download className="h-3 w-3" /> Download .conf
            </button>
            <button
              onClick={verifyThenContinue}
              disabled={vpnCheck.checking}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              {vpnCheck.checking
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Verifying tunnel…</>
                : <><Play className="h-3 w-3" /> Verify tunnel &amp; continue</>}
            </button>
          </div>
          {vpnCheck.connected === false && vpnCheck.reason && (
            <div className="rounded border border-danger/30 bg-danger/5 p-2.5 text-[11px] text-danger">
              <span className="font-semibold">Tunnel not reachable — build not started.</span>{" "}
              {vpnCheck.reason}
            </div>
          )}
        </div>
      )}

      {failed && state.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 space-y-1">
          <div className="text-xs font-semibold text-danger">Build failed at phase "{state.error_phase || "?"}"</div>
          <pre className="text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap">{state.error}</pre>
        </div>
      )}
    </div>
  );
}

// ── Active ranges panel ──

function ActiveRangesPanel({
  ranges, onRefresh, onDestroy, onAbort, onView,
}: {
  ranges: SarOperationStatus[];
  onRefresh: () => void;
  onDestroy: (id: string) => void;
  onAbort: (id: string) => void;
  onView: (id: string) => void;
}) {
  const active = ranges.filter((r) =>
    r.status !== "completed" && !(r.type === "destroy" && r.status === "running"),
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const completed = ranges.filter((r) => r.status === "completed");
  // Two-step confirmation so a destroy/abort can never fire on a single click.
  const [confirming, setConfirming] = useState<{ id: string; action: "destroy" | "abort" } | null>(null);
  // Build progress from the known phase order (queued → … → running).
  const phaseOf = (status: string) => {
    const idx = PHASE_ORDER.findIndex((p) => p.status === status);
    const done = status === "running";
    const pct = done ? 100 : idx >= 0 ? Math.round(((idx + 1) / PHASE_ORDER.length) * 100) : 0;
    return { idx, pct, done, phase: idx >= 0 ? PHASE_ORDER[idx] : null };
  };
  const isBuilding = (status: string) =>
    ["queued", "build_vpn", "wait_for_vpn", "build_lab"].includes(status);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/30">
          <span className="text-xs font-semibold text-foreground">Active ranges ({active.length})
            <span className="ml-2 font-normal text-[10px] text-muted-foreground">click a row for full phase detail · Abort while building · Destroy when done</span>
          </span>
          <button onClick={onRefresh} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> refresh
          </button>
        </div>
        {active.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No active ranges.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30 bg-background/30 text-[11px] text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Template</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Duration</th>
                <th className="px-3 py-2 text-left font-medium">Router IP</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {active.flatMap((r) => {
                const id = r.attack_range_id;
                const key = id || r.created_time || Math.random().toString();
                const building = isBuilding(r.status);
                const { idx, pct, phase } = phaseOf(r.status);
                const isConfirming = !!id && confirming?.id === id;
                const rows = [
                  <tr
                    key={key}
                    onClick={() => id && onView(id)}
                    className="border-b border-border/30 hover:bg-card-hover cursor-pointer"
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{id?.slice(0, 8) || "—"}</td>
                    <td className="px-3 py-2 text-xs text-foreground">{r.attack_range_name || "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.template_name?.replace(/\.yml$/, "") || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", statusStyle(r.status))}>
                        {fmtStatus(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">{durationText(r.created_time, r.end_time)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{r.router_public_ip || "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {id && (isConfirming ? (
                        <span className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => { const a = confirming!.action; setConfirming(null); a === "abort" ? onAbort(id) : onDestroy(id); }}
                            className="text-[11px] bg-danger text-white rounded px-2 py-0.5 inline-flex items-center gap-1"
                          >
                            <XCircle className="h-3 w-3" /> Confirm {confirming!.action}
                          </button>
                          <button onClick={() => setConfirming(null)} className="text-[11px] text-muted-foreground hover:text-foreground">cancel</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirming({ id, action: building ? "abort" : "destroy" })}
                          title={building ? "Stop this build and tear down what was created" : "Tear down all cloud resources for this range"}
                          className="text-[11px] text-danger hover:bg-danger/10 border border-danger/30 rounded px-2 py-0.5 inline-flex items-center gap-1"
                        >
                          {building ? <><XCircle className="h-3 w-3" /> Abort</> : <><Trash2 className="h-3 w-3" /> Destroy</>}
                        </button>
                      ))}
                    </td>
                  </tr>,
                ];
                // Live progress for a range that's still building.
                if (building && phase) {
                  rows.push(
                    <tr key={`${key}-progress`} className="border-b border-border/30 bg-background/20">
                      <td colSpan={7} className="px-3 pt-0 pb-2">
                        <div className="flex items-center gap-2 text-[11px]">
                          <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />
                          <span className="text-foreground font-medium">Phase {idx + 1}/{PHASE_ORDER.length} · {phase.label}</span>
                          <span className="text-muted-foreground truncate">{phase.desc}</span>
                          <span className="ml-auto font-mono text-muted-foreground shrink-0">{pct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted/20 overflow-hidden">
                          <div className="h-full rounded-full bg-accent animate-pulse transition-all duration-700" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        )}
      </div>

      {completed.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 border-b border-border bg-background/30 text-xs font-medium text-foreground"
          >
            <span>Recently completed ({completed.length})</span>
            <span className="text-[11px] text-muted-foreground">{showCompleted ? "hide" : "show"}</span>
          </button>
          {showCompleted && (
            <ul className="divide-y divide-border/30">
              {completed.slice(0, 10).map((r) => (
                <li key={r.attack_range_id} className="px-4 py-2 text-xs text-muted-foreground flex items-center gap-3">
                  <code className="font-mono">{r.attack_range_id?.slice(0, 8)}</code>
                  <span>{r.template_name?.replace(/\.yml$/, "")}</span>
                  <span className="ml-auto">{r.end_time ? new Date(r.end_time).toLocaleString() : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main CloudTab ──

export default function CloudTab({ onJumpToOnPrem }: { onJumpToOnPrem: () => void }) {
  const [health, setHealth] = useState<"unknown" | "up" | "down">("unknown");
  const [healthReason, setHealthReason] = useState<string>("");
  const [providers, setProviders] = useState<SarProviderAvailability[]>([]);
  const [templates, setTemplates] = useState<SarTemplateInfo[]>([]);
  const [ranges, setRanges] = useState<SarOperationStatus[]>([]);
  const [installedLocalCount, setInstalledLocalCount] = useState(0);

  const [selectedTpl, setSelectedTpl] = useState<SarTemplateInfo | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<SarOperationStatus | null>(null);
  const [viewRangeId, setViewRangeId] = useState<string | null>(null);
  const [viewRangeState, setViewRangeState] = useState<SarOperationStatus | null>(null);
  const [createFormProvider, setCreateFormProvider] = useState<SarProvider | null>(null);
  const [filter, setFilter] = useState<"all" | SarProvider>("all");
  const [buildError, setBuildError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [openTerminalForServer, setOpenTerminalForServer] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshRanges = useCallback(async () => {
    try { setRanges((await sarListRanges()).attack_ranges); } catch { /* ignore */ }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const h = await sarHealth();
      setHealth(h.status === "healthy" ? "up" : "down");
      setHealthReason("");
    } catch (e: any) {
      setHealth("down");
      setHealthReason(e?.message || "SAR controller not reachable");
      return;
    }
    try { setProviders((await sarProvidersCheck()).providers); } catch { /* ignore */ }
    try { setTemplates((await sarListTemplates()).templates); } catch { /* ignore */ }
    try {
      const reg = await fetch("/api/detection-lab/registry").then((r) => r.json()).catch(() => ({}));
      setInstalledLocalCount(Array.isArray(reg?.deployments) ? reg.deployments.length : 0);
    } catch { /* ignore */ }
    refreshRanges();
  }, [refreshRanges]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Poll status while watching a build OR a selected running range
  useEffect(() => {
    const idToPoll = buildingId || viewRangeId;
    if (!idToPoll) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const tick = async () => {
      try {
        const s = await sarRangeStatus(idToPoll);
        if (buildingId === idToPoll) setActiveState(s);
        if (viewRangeId === idToPoll) setViewRangeState(s);
        if (buildingId && isSarTerminal(s.status)) {
          refreshRanges();
          // Keep the build progress showing once, but allow user to dismiss
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      } catch { /* ignore transient errors */ }
    };
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [buildingId, viewRangeId, refreshRanges]);

  const handleBuild = async (opts: { ip_whitelist: string; password: string; cloud: Record<string, string> }) => {
    if (!selectedTpl) return;
    setBuildError(null);
    setBuilding(true);
    try {
      const tplId = `${selectedTpl.provider}/${selectedTpl.name}`;
      const r = await sarBuildRange({
        template: tplId,
        general_overrides: {
          ip_whitelist: opts.ip_whitelist,
          attack_range_password: opts.password,
        },
        cloud_overrides: Object.keys(opts.cloud).length > 0
          ? { [selectedTpl.provider]: opts.cloud }
          : undefined,
      });
      setBuildingId(r.attack_range_id);
      setSelectedTpl(null);
      refreshRanges();
    } catch (e: any) {
      setBuildError(e?.message || "Build request failed");
    } finally {
      setBuilding(false);
    }
  };

  const handleContinue = async () => {
    if (!buildingId) return;
    try { await sarBuildRange({ attack_range_id: buildingId }); }
    catch (e: any) { setBuildError(e?.message || "Continue request failed"); }
  };

  const handleAbort = async () => {
    const id = viewRangeId || buildingId;
    if (!id) return;
    try {
      await sarAbortRange({ attack_range_id: id });
      setBuildingId(null); setActiveState(null);
      setViewRangeId(null); setViewRangeState(null);
      refreshRanges();
    } catch { /* ignore */ }
  };

  // Destroy without prompting — callers that already confirmed in the UI (the
  // Active-ranges table's two-step confirm) use this directly.
  const destroyNow = async (id: string) => {
    try {
      await sarDestroyRange({ attack_range_id: id });
      refreshRanges();
      if (buildingId === id) { setBuildingId(null); setActiveState(null); }
      if (viewRangeId === id) { setViewRangeId(null); setViewRangeState(null); }
    } catch (e: any) {
      alert(`Destroy failed: ${e?.message || e}`);
    }
  };

  const handleDestroy = async (id: string) => {
    if (!confirm(`Destroy range ${id.slice(0, 8)}? This will tear down all cloud resources.`)) return;
    await destroyNow(id);
  };

  // Abort a specific in-progress build (the table acts per-row, unlike handleAbort
  // which targets the currently-viewed/building range).
  const abortById = async (id: string) => {
    try {
      await sarAbortRange({ attack_range_id: id });
      if (buildingId === id) { setBuildingId(null); setActiveState(null); }
      if (viewRangeId === id) { setViewRangeId(null); setViewRangeState(null); }
      refreshRanges();
    } catch { /* ignore */ }
  };

  const handleView = (id: string) => {
    setViewRangeId(id);
    setSelectedTpl(null);
    setBuildingId(null);
    setActiveState(null);
    setOpenTerminalForServer(null);
  };

  const handleBackFromDetail = () => {
    setViewRangeId(null);
    setViewRangeState(null);
    setOpenTerminalForServer(null);
  };

  if (health === "down") {
    return <SarUnavailableBanner reason={healthReason} onJumpToOnPrem={onJumpToOnPrem} />;
  }

  // Decide what the center area shows
  const centerContent = (() => {
    if (viewRangeId && viewRangeState) {
      // Build a terminal slot if a server is open
      const archServers = viewRangeState.result?.architecture || [];
      const terminalSlot = (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {archServers.map((s) => (
              <button
                key={s.name}
                onClick={() => setOpenTerminalForServer(s.name)}
                className={cn(
                  "text-[11px] font-medium px-2.5 py-1 rounded-full border",
                  openTerminalForServer === s.name
                    ? "bg-accent/10 text-accent border-accent/30"
                    : "text-muted-foreground border-border hover:bg-card-hover",
                )}
              >
                Open terminal: {s.name}
              </button>
            ))}
          </div>
          {openTerminalForServer && viewRangeState.attack_range_id && (
            <TerminalPanel
              rangeId={viewRangeState.attack_range_id}
              serverName={openTerminalForServer}
              architecture={archServers}
              guacamoleHostIp={viewRangeState.result?.guacamole_info?.host_ip}
              onClose={() => setOpenTerminalForServer(null)}
            />
          )}
        </div>
      );

      return (
        <RunningRangeDetail
          state={viewRangeState}
          onBack={handleBackFromDetail}
          onDestroy={() => handleDestroy(viewRangeState.attack_range_id!)}
          onAbort={handleAbort}
          onRefresh={() => { refreshRanges(); }}
          TerminalSlot={terminalSlot}
        />
      );
    }
    if (activeState && buildingId) {
      return <CloudBuildProgress state={activeState} onContinue={handleContinue} onAbort={handleAbort} />;
    }
    if (selectedTpl) {
      return (
        <CloudTemplateDetail
          tpl={selectedTpl}
          onBack={() => { setSelectedTpl(null); setBuildError(null); }}
          onBuild={handleBuild}
          error={buildError}
          building={building}
        />
      );
    }
    if (templates.length === 0) {
      return (
        <div className="rounded-lg border border-border bg-card p-6 text-xs text-muted-foreground text-center">
          <Cloud className="h-6 w-6 mx-auto mb-2 opacity-50" />
          {health === "unknown" ? "Loading templates…" : "No templates available from SAR."}
        </div>
      );
    }
    return (
      <ProviderGroupedGrid
        templates={templates}
        filter={filter}
        onSelect={(tpl) => setSelectedTpl(tpl)}
        onCreateCustom={(p) => setCreateFormProvider(p)}
      />
    );
  })();

  return (
    <div className="space-y-4">
      <HostInfoHeader
        providers={providers}
        templates={templates}
        ranges={ranges}
        installedLocalCount={installedLocalCount}
      />

      <ConnectivityHealthStrip
        ranges={ranges}
        onOpenRange={(id) => handleView(id)}
      />

      {/* Filter chips when grid is visible */}
      {!viewRangeId && !selectedTpl && !buildingId && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter:</span>
          {(["all", "aws", "azure", "gcp"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={cn(
                "flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors",
                filter === p
                  ? "bg-accent/10 text-accent border-accent/30"
                  : "text-muted-foreground border-border hover:bg-card-hover",
              )}
            >
              {p !== "all" && <ProviderIcon provider={p as SarProvider} />}
              {p === "all" ? "All" : p.toUpperCase()}
            </button>
          ))}
          <div className="ml-auto text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Info className="h-3 w-3" />
            Templates pulled live from SAR — pass host cloud creds through <code className="font-mono">~/.aws</code>, <code className="font-mono">~/.azure</code>, <code className="font-mono">~/.config/gcloud</code>.
          </div>
        </div>
      )}

      {centerContent}

      <ActiveRangesPanel
        ranges={ranges}
        onRefresh={refreshRanges}
        onDestroy={destroyNow}
        onAbort={abortById}
        onView={handleView}
      />

      {createFormProvider && (
        <CreateTemplateForm
          provider={createFormProvider}
          onClose={() => setCreateFormProvider(null)}
          onCreated={() => {
            setCreateFormProvider(null);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}
