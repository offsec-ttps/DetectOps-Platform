"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Rocket, X } from "lucide-react";
import type { SarProvider } from "@/types/sar";
import { sarCloudFields, sarSuggestedIp } from "@/lib/sar-client";
import { ProviderIcon } from "./_shared";
import { cn } from "@/lib/utils";

const DEFAULT_ROLES = [
  "P4T12ICK.ludus_ar_splunk",
  "P4T12ICK.ludus_ar_windows",
  "P4T12ICK.ludus_ar_linux",
  "P4T12ICK.ar_kali",
  "P4T12ICK.ar_guacamole",
  "P4T12ICK.ar_zeek",
  "P4T12ICK.ar_soar",
];

interface ServerDraft {
  name: string;
  os: "linux" | "windows";
  instance_type: string;
  ip_last_octet: number;
  roles: string[];
}

const DEFAULT_INSTANCES: Record<SarProvider, { linux: string; windows: string }> = {
  aws:   { linux: "t3.xlarge", windows: "t3.large" },
  azure: { linux: "Standard_D4s_v3", windows: "Standard_D2s_v3" },
  gcp:   { linux: "e2-standard-4", windows: "e2-standard-4" },
};

export default function CreateTemplateForm({
  provider, onClose, onCreated,
}: {
  provider: SarProvider;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [password, setPassword] = useState("changeme123!");
  const [ipWhitelist, setIpWhitelist] = useState("");
  const [regionField, setRegionField] = useState<{ key: string; options: string[]; label: string } | null>(null);
  const [regionValue, setRegionValue] = useState("");
  const [servers, setServers] = useState<ServerDraft[]>([
    {
      name: "splunk", os: "linux",
      instance_type: DEFAULT_INSTANCES[provider].linux,
      ip_last_octet: 10,
      roles: ["P4T12ICK.ludus_ar_splunk"],
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sarSuggestedIp().then((r) => { if (!cancelled) setIpWhitelist(r.cidr); }).catch(() => {});
    sarCloudFields(provider).then((r) => {
      if (cancelled) return;
      const entries = Object.entries(r.fields);
      const first = entries[0]; // aws=region, azure=location, gcp=region
      if (first) {
        const [key, f] = first;
        setRegionField({ key, options: f.options || [], label: f.label });
        setRegionValue(f.default || (f.options && f.options[0]) || "");
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [provider]);

  const updateServer = (i: number, patch: Partial<ServerDraft>) => {
    setServers((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };
  const addServer = () => {
    const nextOctet = Math.max(10, ...servers.map((s) => s.ip_last_octet)) + 1;
    setServers((prev) => [
      ...prev,
      {
        name: `server${prev.length + 1}`,
        os: "linux",
        instance_type: DEFAULT_INSTANCES[provider].linux,
        ip_last_octet: Math.min(50, nextOctet),
        roles: [],
      },
    ]);
  };
  const removeServer = (i: number) => {
    setServers((prev) => prev.filter((_, idx) => idx !== i));
  };
  const toggleRole = (i: number, role: string) => {
    setServers((prev) => prev.map((s, idx) => {
      if (idx !== i) return s;
      const has = s.roles.includes(role);
      return { ...s, roles: has ? s.roles.filter((r) => r !== role) : [...s.roles, role] };
    }));
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const regionKeyValue = regionField ? { [regionField.key]: regionValue } : {};
      const res = await fetch("/api/detection-lab/cloud/custom-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          name,
          description,
          password,
          ip_whitelist: ipWhitelist,
          ...regionKeyValue,
          servers,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ProviderIcon provider={provider} className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-foreground">Create custom {provider.toUpperCase()} template</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Writes a YAML file into SAR's template directory. SAR picks it up on the next templates list — no restart needed.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Template name</span>
            <input
              value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="my_custom_aws"
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground"
            />
            <span className="text-[10px] text-muted-foreground">lowercase, digits, and _ only. 3-41 chars.</span>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Attack range password</span>
            <input
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground"
            />
          </label>
          <label className="block col-span-2">
            <span className="text-[11px] font-medium text-muted-foreground">Description</span>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this template for?"
              rows={2}
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">IP whitelist (CIDR)</span>
            <input
              value={ipWhitelist} onChange={(e) => setIpWhitelist(e.target.value)}
              placeholder="e.g. 203.0.113.9/32 — your public IP"
              className={cn("mt-1 block w-full rounded-lg border bg-background px-3 py-1.5 text-xs font-mono text-foreground",
                /^(127\.|0\.0\.0\.0)/.test(ipWhitelist) || !ipWhitelist ? "border-warning/50" : "border-border")}
            />
            {/* A loopback/empty whitelist builds a security group that allows nobody,
                and the build then dies with "SSH is not available on router" after 5min. */}
            {(!ipWhitelist || /^(127\.|0\.0\.0\.0)/.test(ipWhitelist)) && (
              <span className="mt-1 block text-[10px] text-warning">
                Must be this host&apos;s <strong>public</strong> IP (e.g. <span className="font-mono">x.x.x.x/32</span>). A loopback/empty value
                creates a security group that blocks SSH, and the build fails with “SSH is not available on router”.
              </span>
            )}
          </label>
          {regionField && (
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">{regionField.label}</span>
              {regionField.options.length > 0 ? (
                <select
                  value={regionValue} onChange={(e) => setRegionValue(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                >
                  {regionField.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  value={regionValue} onChange={(e) => setRegionValue(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono text-foreground"
                />
              )}
            </label>
          )}
        </div>

        {/* Servers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground">Servers</h3>
            <button
              onClick={addServer}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-accent border border-accent/30 rounded-full px-2.5 py-1 hover:bg-accent/10"
            >
              <Plus className="h-3 w-3" /> Add server
            </button>
          </div>
          {servers.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-background/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">Server {i + 1}</span>
                {servers.length > 1 && (
                  <button onClick={() => removeServer(i)} className="text-muted-foreground hover:text-danger">
                    <Minus className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">Name</span>
                  <input
                    value={s.name}
                    onChange={(e) => updateServer(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                    className="mt-0.5 block w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">OS</span>
                  <select
                    value={s.os}
                    onChange={(e) => updateServer(i, {
                      os: e.target.value as "linux" | "windows",
                      instance_type: DEFAULT_INSTANCES[provider][e.target.value as "linux" | "windows"],
                    })}
                    className="mt-0.5 block w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  >
                    <option value="linux">Linux</option>
                    <option value="windows">Windows</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">Instance type</span>
                  <input
                    value={s.instance_type}
                    onChange={(e) => updateServer(i, { instance_type: e.target.value })}
                    className="mt-0.5 block w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-muted-foreground">IP .x (10-50)</span>
                  <input
                    type="number" min={10} max={50}
                    value={s.ip_last_octet}
                    onChange={(e) => updateServer(i, { ip_last_octet: parseInt(e.target.value) || 10 })}
                    className="mt-0.5 block w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                  />
                </label>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Roles</span>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {DEFAULT_ROLES.map((r) => (
                    <button
                      key={r} onClick={() => toggleRole(i, r)}
                      className={cn(
                        "text-[11px] font-mono px-2 py-0.5 rounded-full border",
                        s.roles.includes(r)
                          ? "bg-accent/10 text-accent border-accent/30"
                          : "text-muted-foreground border-border hover:bg-card-hover",
                      )}
                    >
                      {r.replace(/^P4T12ICK\./, "")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-[11px] font-mono text-danger bg-danger/5 border border-danger/20 rounded px-2 py-1">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={submit} disabled={submitting || !name}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
          >
            <Rocket className="h-3 w-3" /> {submitting ? "Creating…" : "Create template"}
          </button>
        </div>
      </div>
    </div>
  );
}
