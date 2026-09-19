"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft, Check, Copy, Download, ExternalLink, Eye, EyeOff, Info, Pencil,
  PowerOff, Share2, Shield, Terminal as TerminalIcon, Trash2,
} from "lucide-react";
import Link from "next/link";
import type {
  SarArchitectureServer, SarDefaultCredential, SarGuacamoleServer,
  SarOperationStatus, SarProvider,
} from "@/types/sar";
import { sarShareRange, sarUpdateRangeName } from "@/lib/sar-client";
import { ProviderIcon, copyToClipboard, downloadText, durationText, fmtStatus, statusStyle } from "./_shared";
import IpSyncCard from "./IpSyncCard";
import { cn } from "@/lib/utils";

// ── Small primitive: label/value pair with optional copy ──

function InfoRow({ label, value, mono, copyable }: {
  label: string; value: string | null | undefined; mono?: boolean; copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">—</span>
    </div>
  );
  const doCopy = async () => {
    await copyToClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn("text-xs text-foreground truncate", mono && "font-mono")} title={value}>{value}</span>
        {copyable && (
          <button onClick={doCopy} className="text-muted-foreground hover:text-foreground flex-shrink-0" title="Copy">
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Section: architecture ──

function ArchitectureSection({ servers, ipByName }: {
  servers: SarArchitectureServer[];
  /** Optional map of server-name → actual hostname from guacamole_info. Falls back to 10.0.2.{ip_last_octet}. */
  ipByName?: Record<string, string>;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copyIp = async (ip: string) => {
    try { await navigator.clipboard.writeText(ip); setCopied(ip); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  };
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
            const ip = ipByName?.[s.name]
              || (typeof s.ip_last_octet === "number" ? `10.0.2.${s.ip_last_octet}` : null);
            return (
              <tr key={s.name} className="border-t border-border/40">
                <td className="px-3 py-2 font-mono text-foreground">{s.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.os_type || "—"}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{s.instance_type || "—"}</td>
                <td className="px-3 py-2 font-mono text-foreground">
                  {ip ? (
                    <button onClick={() => copyIp(ip)} className="inline-flex items-center gap-1 hover:text-accent" title="Copy">
                      {ip}
                      {copied === ip ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                    </button>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{(s.roles || []).join(", ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Section: default credentials ──

function CredentialRow({ c }: { c: SarDefaultCredential }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    await copyToClipboard(c.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <tr className="border-t border-border/40">
      <td className="px-3 py-2 text-foreground">{c.service}</td>
      <td className="px-3 py-2 font-mono text-muted-foreground">{c.server || "—"}</td>
      <td className="px-3 py-2 font-mono text-foreground">{c.username}</td>
      <td className="px-3 py-2 font-mono text-muted-foreground">
        <span className="select-all">{show ? c.password : "••••••••"}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <button onClick={() => setShow((v) => !v)} className="text-muted-foreground hover:text-foreground mr-2" title={show ? "Hide" : "Show"}>
          {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button onClick={doCopy} className="text-muted-foreground hover:text-foreground" title="Copy password">
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </td>
    </tr>
  );
}

function CredentialsSection({ creds }: { creds: SarDefaultCredential[] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-background/50 text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Service</th>
            <th className="px-3 py-2 text-left font-medium">Server</th>
            <th className="px-3 py-2 text-left font-medium">Username</th>
            <th className="px-3 py-2 text-left font-medium">Password</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {creds.map((c, i) => <CredentialRow key={`${c.service}-${c.server || ""}-${i}`} c={c} />)}
        </tbody>
      </table>
    </div>
  );
}

// ── Section: access (WG + Guacamole + Splunk link) ──

function AccessSection({ state, guacamoleServers }: {
  state: SarOperationStatus;
  guacamoleServers?: SarGuacamoleServer[];
}) {
  const splunkServer = (state.result?.architecture || []).find((s) => s.name === "splunk");
  const splunkIp = splunkServer ? `10.0.2.${splunkServer.ip_last_octet ?? 10}` : null;

  return (
    <div className="space-y-3">
      {/* IP whitelist sync — shown first because this is the #1 cause of tunnel issues */}
      {state.attack_range_id && <IpSyncCard rangeId={state.attack_range_id} />}

      {/* WireGuard */}
      {state.wireguard_config && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Shield className="h-3.5 w-3.5 text-accent" /> WireGuard tunnel
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => copyToClipboard(state.wireguard_config!)}
                className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 inline-flex items-center gap-1"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
              <button
                onClick={() => downloadText(state.wireguard_config!, `${state.attack_range_id?.slice(0, 8)}.conf`)}
                className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 inline-flex items-center gap-1"
              >
                <Download className="h-3 w-3" /> .conf
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Router: <code className="font-mono text-foreground">{state.router_public_ip || "—"}</code>
          </p>
        </div>
      )}

      {/* Splunk */}
      {splunkIp && (
        <div className="rounded-lg border border-border p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-foreground">Splunk Web</div>
            <code className="text-[11px] font-mono text-muted-foreground">http://{splunkIp}:8000</code>
          </div>
          <a
            href={`http://${splunkIp}:8000`} target="_blank" rel="noopener noreferrer"
            className="text-[11px] font-medium text-accent hover:bg-accent/10 border border-accent/30 rounded px-2 py-0.5 inline-flex items-center gap-1"
          >
            Open <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {/* Guacamole */}
      {guacamoleServers && guacamoleServers.length > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-foreground">Guacamole (web RDP/SSH)</div>
            {state.result?.guacamole_info?.host_ip && (
              <a
                href={`http://${state.result.guacamole_info.host_ip}:8080`}
                target="_blank" rel="noopener noreferrer"
                className="ml-auto text-[11px] font-medium text-accent hover:bg-accent/10 border border-accent/30 rounded px-2 py-0.5 inline-flex items-center gap-1"
              >
                Open Guacamole <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <table className="w-full text-xs">
            <thead className="text-[11px] text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Host</th>
                <th className="px-2 py-1 text-left font-medium">Protocol</th>
                <th className="px-2 py-1 text-left font-medium">Port</th>
                <th className="px-2 py-1 text-left font-medium">Username</th>
              </tr>
            </thead>
            <tbody>
              {guacamoleServers.map((g) => (
                <tr key={`${g.name}-${g.port}`} className="border-t border-border/40">
                  <td className="px-2 py-1 font-mono text-foreground">{g.name}</td>
                  <td className="px-2 py-1 text-muted-foreground uppercase">{g.protocol}</td>
                  <td className="px-2 py-1 font-mono text-muted-foreground">{g.port}</td>
                  <td className="px-2 py-1 font-mono text-muted-foreground">{g.username}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground italic">Requires WireGuard tunnel connected.</p>
        </div>
      )}
    </div>
  );
}

// ── Section: share ──

function ShareSection({ state, onShared }: {
  state: SarOperationStatus;
  onShared: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doShare = async () => {
    if (!state.attack_range_id || !name.trim()) return;
    setSubmitting(true); setErr(null);
    try {
      await sarShareRange({ attack_range_id: state.attack_range_id, name: name.trim() });
      setName("");
      onShared();
    } catch (e: any) {
      setErr(e?.message || "Share failed");
    } finally {
      setSubmitting(false);
    }
  };

  const entries = Object.entries(state.sharing || {});

  return (
    <div className="space-y-3">
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(([shareName, config]) => (
            <div key={shareName} className="flex items-center justify-between rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2">
                <Share2 className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-medium text-foreground">{shareName}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => copyToClipboard(config)}
                  className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 inline-flex items-center gap-1"
                >
                  <Copy className="h-3 w-3" /> Copy
                </button>
                <button
                  onClick={() => downloadText(config, `${shareName}.conf`)}
                  className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 inline-flex items-center gap-1"
                >
                  <Download className="h-3 w-3" /> .conf
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Teammate name (e.g. alice)"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
        />
        <button
          onClick={doShare} disabled={submitting || !name.trim()}
          className="rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40 inline-flex items-center gap-1"
        >
          <Share2 className="h-3 w-3" /> {submitting ? "Generating…" : "Generate config"}
        </button>
      </div>
      {err && <p className="text-[11px] text-danger">{err}</p>}
    </div>
  );
}

// ── Section card wrapper ──

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// ── Main component ──

export default function RunningRangeDetail({
  state, onBack, onDestroy, onAbort, onRefresh, TerminalSlot,
}: {
  state: SarOperationStatus;
  onBack: () => void;
  onDestroy: () => void;
  onAbort: () => void;
  onRefresh: () => void;
  /** Slot for Phase 4 terminal panel — if omitted, shows a placeholder note. */
  TerminalSlot?: React.ReactNode;
}) {
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(state.attack_range_name || "ar");
  const [savingName, setSavingName] = useState(false);

  const provider: SarProvider | null = (() => {
    const tpl = state.template_name || "";
    if (tpl.endsWith("aws.yml")) return "aws";
    if (tpl.endsWith("azure.yml")) return "azure";
    if (tpl.endsWith("gcp.yml")) return "gcp";
    return null;
  })();

  const creds = state.result?.default_credentials || [];
  const arch = state.result?.architecture || [];
  const guacamoleServers = state.result?.guacamole_info?.servers;

  const saveName = useCallback(async () => {
    if (!state.attack_range_id || !newName.trim()) return;
    setSavingName(true);
    try {
      await sarUpdateRangeName({ attack_range_id: state.attack_range_id, attack_range_name: newName.trim() });
      setEditingName(false);
      onRefresh();
    } catch {
      /* ignore — leave edit open so user can retry */
    } finally {
      setSavingName(false);
    }
  }, [state.attack_range_id, newName, onRefresh]);

  const isBuilding = !["running", "completed", "failed", "error", "aborted"].includes(state.status);
  const showDestroy = state.status === "running";
  const simulateHref = state.attack_range_id
    ? `/campaign-designer?target=${encodeURIComponent(state.attack_range_id)}`
    : "/campaign-designer";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          {provider && <ProviderIcon provider={provider} className="h-4 w-4" />}
          {editingName ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                value={newName} onChange={(e) => setNewName(e.target.value)}
                autoFocus
                className="flex-1 max-w-xs rounded-lg border border-border bg-background px-2 py-1 text-sm font-semibold text-foreground"
              />
              <button
                onClick={saveName} disabled={savingName}
                className="text-[11px] text-accent border border-accent/30 rounded px-2 py-0.5"
              >
                {savingName ? "Saving…" : "Save"}
              </button>
              <button onClick={() => { setEditingName(false); setNewName(state.attack_range_name || "ar"); }} className="text-[11px] text-muted-foreground">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{state.attack_range_name || "ar"}</h2>
              <button onClick={() => setEditingName(true)} className="text-muted-foreground hover:text-foreground" title="Edit name">
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", statusStyle(state.status))}>
            {fmtStatus(state.status)}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {state.attack_range_id && (
              <a
                href={`http://localhost:4321/attack-ranges/${state.attack_range_id}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1 inline-flex items-center gap-1"
              >
                SAR UI <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {isBuilding && (
              <button onClick={onAbort} className="text-[11px] text-muted-foreground hover:text-danger border border-border rounded px-2 py-1 inline-flex items-center gap-1">
                <PowerOff className="h-3 w-3" /> Abort
              </button>
            )}
            {showDestroy && (
              <button onClick={onDestroy} className="text-[11px] font-medium text-danger border border-danger/30 rounded px-2 py-1 inline-flex items-center gap-1 hover:bg-danger/5">
                <Trash2 className="h-3 w-3" /> Destroy
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Info className="h-3 w-3" />
          Build and manage the attack range infrastructure
        </p>
      </div>

      {/* Basic Information */}
      <Card title="Basic Information">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <InfoRow label="Range ID" value={state.attack_range_id} mono copyable />
          <InfoRow label="Template" value={state.template_name} mono />
          <InfoRow label="Router public IP" value={state.router_public_ip} mono copyable />
          <InfoRow label="Status" value={fmtStatus(state.status)} />
          <InfoRow label="Created" value={state.created_time ? new Date(state.created_time).toLocaleString() : null} />
          <InfoRow label="End" value={state.end_time ? new Date(state.end_time).toLocaleString() : "—"} />
          <InfoRow label="Duration" value={durationText(state.created_time, state.end_time)} />
          <InfoRow label="Config file" value={(state.result?.config_file as string) || null} mono />
          {state.error_phase && <InfoRow label="Error phase" value={state.error_phase} />}
        </div>
      </Card>

      {/* Architecture */}
      {arch.length > 0 && (
        <Card title="Architecture">
          <ArchitectureSection
            servers={arch}
            ipByName={Object.fromEntries((guacamoleServers || []).map((g) => [g.name, g.hostname]))}
          />
        </Card>
      )}

      {/* Credentials */}
      {creds.length > 0 && (
        <Card title="Default credentials">
          <CredentialsSection creds={creds} />
        </Card>
      )}

      {/* Access */}
      {(state.wireguard_config || guacamoleServers) && (
        <Card title="Access">
          <AccessSection state={state} guacamoleServers={guacamoleServers} />
        </Card>
      )}

      {/* Share */}
      {state.attack_range_id && (state.status === "running" || state.status === "wait_for_vpn") && (
        <Card title="Share WireGuard access">
          <ShareSection state={state} onShared={onRefresh} />
        </Card>
      )}

      {/* Simulate + Terminal */}
      {state.status === "running" && (
        <Card title="Simulate & execute" right={
          <Link
            href={simulateHref}
            className="text-[11px] font-medium text-accent bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded px-2.5 py-1 inline-flex items-center gap-1"
          >
            Simulate in Campaign Designer <ExternalLink className="h-3 w-3" />
          </Link>
        }>
          <p className="text-xs text-muted-foreground">
            Run techniques through the unified Campaign Designer flow, or drop into a terminal on any host below.
          </p>
          {TerminalSlot ? (
            <div className="mt-3">{TerminalSlot}</div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground text-center flex items-center justify-center gap-2">
              <TerminalIcon className="h-3 w-3" />
              Terminal integration available once a target is selected in Campaign Designer.
            </div>
          )}
        </Card>
      )}

      {/* Error traceback */}
      {state.error && (
        <Card title="Error">
          <p className="text-xs font-medium text-danger">{state.error}</p>
          {state.traceback && (
            <pre className="text-[11px] font-mono text-muted-foreground bg-background border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
              {state.traceback}
            </pre>
          )}
        </Card>
      )}
    </div>
  );
}
