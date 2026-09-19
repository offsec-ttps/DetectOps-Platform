"use client";

import { useEffect, useState } from "react";
import {
  Server, Cloud, Cpu, GitBranch, Save, Loader2, AlertTriangle, X, Network as NetIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import PayloadUploader from "./PayloadUploader";

export type EnvKind = "our-template-deployed" | "user-cloud" | "agent" | "shell";

interface EnvDraft {
  id?: string;
  name: string;
  kind: EnvKind;
  templateRef?: string;
  cloudProvider?: string;
  shellMode?: string;
  description?: string;
  hostname?: string;
  port?: number;
  region?: string;
  credentialId?: string | null;
  sshUser?: string;
  sshKeyRef?: string;
  agentEnrollmentToken?: string;
  listenerHost?: string;
  listenerPort?: number;
  payloadKind?: string;
  payloadRef?: string;
  enabled?: boolean;
}

interface CloudCredential { id: string; label: string; provider: string }

interface Props {
  draft: EnvDraft;
  onSaved: (saved: { id: string; name: string; kind: string }) => void;
  onCancel: () => void;
}

const KIND_META: Record<EnvKind, { label: string; Icon: React.ComponentType<{ className?: string }>; blurb: string }> = {
  "our-template-deployed": {
    label: "Our template (SAR / GOAD)",
    Icon: Server,
    blurb: "A Splunk Attack Range or GOAD instance deployed via platform templates. Runner SSH-executes ART / manual steps on the attack host.",
  },
  "user-cloud": {
    label: "User cloud (AWS / Azure / GCP)",
    Icon: Cloud,
    blurb: "Your own cloud account. Phase 3 runs Stratus steps via the existing Stratus runner using the saved CloudCredential.",
  },
  agent: {
    label: "Agent-based",
    Icon: Cpu,
    blurb: "Agent enrolled on a target host via HTTP polling. Phase 3 stub — token stored encrypted; real runner ships next.",
  },
  shell: {
    label: "Reverse / bind shell",
    Icon: GitBranch,
    blurb: "Listener + payload-staged shell. Phase 3 stub — payload SHA-256 stored locally; real runner ships next.",
  },
};

export default function EnvironmentForm({ draft, onSaved, onCancel }: Props) {
  const [data, setData] = useState<EnvDraft>(draft);
  const [creds, setCreds] = useState<CloudCredential[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load cloud credentials so user-cloud forms can pick one
  useEffect(() => {
    fetch("/api/cloud-credentials")
      .then((r) => r.json())
      .then((d) => setCreds(d.items || d.credentials || []))
      .catch(() => setCreds([]));
  }, []);

  const update = (patch: Partial<EnvDraft>) => setData({ ...data, ...patch });

  const save = async () => {
    setError(null);
    if (!data.name.trim()) { setError("name is required"); return; }
    setSaving(true);
    try {
      const isUpdate = !!data.id;
      const url = isUpdate ? `/api/environment-targets/${data.id}` : "/api/environment-targets";
      const r = await fetch(url, {
        method: isUpdate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const out = await r.json();
      if (!r.ok) { setError(out.error || "save failed"); return; }
      onSaved({ id: out.id || data.id!, name: data.name, kind: data.kind });
    } catch (err: any) {
      setError(err?.message || "save failed");
    } finally { setSaving(false); }
  };

  const meta = KIND_META[data.kind];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <meta.Icon className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">
          {data.id ? "Edit environment" : "New environment"}
        </h3>
        <div className="ml-auto inline-flex items-center gap-2">
          <button onClick={onCancel} className="inline-flex items-center gap-1 text-[11px] h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /> Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !data.name.trim()}
            className="inline-flex items-center gap-1.5 text-[11px] h-7 px-3 rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save environment
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 border-b border-danger/30 bg-danger/10 text-[11px] text-danger inline-flex items-center gap-2 w-full">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Kind selector */}
        {!data.id && (
          <div>
            <Label>Environment kind</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {(Object.keys(KIND_META) as EnvKind[]).map((k) => {
                const km = KIND_META[k];
                const sel = data.kind === k;
                return (
                  <button
                    key={k}
                    onClick={() => update({ kind: k })}
                    className={cn(
                      "text-left rounded-md border px-3 py-2 transition-colors",
                      sel
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-accent/40",
                    )}
                  >
                    <div className="inline-flex items-center gap-1.5">
                      <km.Icon className={cn("h-3.5 w-3.5", sel ? "text-accent" : "text-muted-foreground")} />
                      <span className="text-xs font-semibold">{km.label}</span>
                    </div>
                    <div className="text-[10px] mt-0.5 leading-snug">{km.blurb}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Name + description (common) */}
        <Field label="Name" required>
          <input type="text" value={data.name} onChange={(e) => update({ name: e.target.value })}
            placeholder="e.g. sar-local-lab"
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </Field>
        <Field label="Description">
          <input type="text" value={data.description || ""} onChange={(e) => update({ description: e.target.value })}
            placeholder="One-line summary (optional)"
            className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
        </Field>

        {/* ─── our-template-deployed ─── */}
        {data.kind === "our-template-deployed" && (
          <>
            <Field label="Template">
              <select value={data.templateRef || ""} onChange={(e) => update({ templateRef: e.target.value })}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono">
                <option value="">(choose…)</option>
                <option value="splunk-attack-range">Splunk Attack Range</option>
                <option value="goad">GOAD</option>
                <option value="custom">Custom / other</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Hostname / IP" required>
                <input type="text" value={data.hostname || ""} onChange={(e) => update({ hostname: e.target.value })}
                  placeholder="10.0.1.5 or sar.lab.local"
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
              </Field>
              <Field label="SSH port">
                <input type="number" value={data.port || 22} onChange={(e) => update({ port: parseInt(e.target.value, 10) || 0 })}
                  placeholder="22"
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="SSH user" required>
                <input type="text" value={data.sshUser || ""} onChange={(e) => update({ sshUser: e.target.value })}
                  placeholder="ubuntu"
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
              </Field>
              <Field label="SSH key path">
                <input type="text" value={data.sshKeyRef || ""} onChange={(e) => update({ sshKeyRef: e.target.value })}
                  placeholder="/var/lib/detectops/keys/sar.pem"
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
              </Field>
            </div>
          </>
        )}

        {/* ─── user-cloud ─── */}
        {data.kind === "user-cloud" && (
          <>
            <Field label="Cloud provider" required>
              <select value={data.cloudProvider || ""} onChange={(e) => update({ cloudProvider: e.target.value })}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                <option value="">(choose…)</option>
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcp">GCP</option>
              </select>
            </Field>
            <Field label="Cloud credential" required>
              <select value={data.credentialId || ""} onChange={(e) => update({ credentialId: e.target.value })}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                <option value="">(choose…)</option>
                {creds.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} ({c.provider})</option>
                ))}
              </select>
              {creds.length === 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  No cloud credentials yet. Create one at <a href="/integrations" className="text-accent hover:underline">/integrations</a>.
                </p>
              )}
            </Field>
            <Field label="Region">
              <input type="text" value={data.region || ""} onChange={(e) => update({ region: e.target.value })}
                placeholder="us-east-1 / eastus / us-central1"
                className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
            </Field>
          </>
        )}

        {/* ─── agent ─── */}
        {data.kind === "agent" && (
          <>
            <Field label="Hostname / callback URL">
              <input type="text" value={data.hostname || ""} onChange={(e) => update({ hostname: e.target.value })}
                placeholder="https://detectops.example.com/agent-callback"
                className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
            </Field>
            <Field label="Agent enrollment token" required>
              <input type="password" value={data.agentEnrollmentToken || ""} onChange={(e) => update({ agentEnrollmentToken: e.target.value })}
                placeholder={data.id ? "Leave blank to keep existing token" : "Plain text — encrypted at rest"}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
              <p className="text-[10px] text-muted-foreground mt-1">
                Encrypted with the platform vault key before persistence. Phase 3 ships a stub runner — see runner contract.
              </p>
            </Field>
          </>
        )}

        {/* ─── shell ─── */}
        {data.kind === "shell" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Shell mode" required>
                <select value={data.shellMode || ""} onChange={(e) => update({ shellMode: e.target.value })}
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                  <option value="">(choose…)</option>
                  <option value="reverse">Reverse</option>
                  <option value="bind">Bind</option>
                </select>
              </Field>
              <Field label="Payload kind">
                <select value={data.payloadKind || ""} onChange={(e) => update({ payloadKind: e.target.value })}
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                  <option value="">(auto-detect on upload)</option>
                  <option value="script">script</option>
                  <option value="binary">binary</option>
                  <option value="inline">inline</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Listener host" required>
                <input type="text" value={data.listenerHost || ""} onChange={(e) => update({ listenerHost: e.target.value })}
                  placeholder="10.0.1.100"
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
              </Field>
              <Field label="Listener port" required>
                <input type="number" value={data.listenerPort || 0} onChange={(e) => update({ listenerPort: parseInt(e.target.value, 10) || 0 })}
                  placeholder="4444"
                  className="w-full px-2 py-1 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent font-mono" />
              </Field>
            </div>
            {data.id ? (
              <PayloadUploader envId={data.id} initial={{ payloadRef: data.payloadRef }} onUploaded={(m) => update({ payloadRef: m.payloadRef })} />
            ) : (
              <p className="text-[10px] text-muted-foreground italic">
                Save the env first, then upload the payload artefact.
              </p>
            )}
          </>
        )}

        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-1">
          <NetIcon className="h-3 w-3" />
          {meta.blurb}
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block font-semibold">{children}</span>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">{label}{required && <span className="text-danger ml-0.5">*</span>}</span>
      {children}
    </label>
  );
}
