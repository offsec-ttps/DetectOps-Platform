"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  KeyRound, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2,
  Shield, ShieldAlert, ShieldQuestion, ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CredentialRow {
  id: string;
  provider: string;
  label: string;
  hasAccessKey: boolean;
  accessKeyTail: string;
  hasSessionToken: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

const PROVIDERS = [
  { id: "aws",        label: "AWS" },
  { id: "azure",      label: "Azure" },
  { id: "gcp",        label: "Google Cloud" },
  { id: "kubernetes", label: "Kubernetes" },
  { id: "entra-id",   label: "Entra ID" },
] as const;

const PROVIDER_BG: Record<string, string> = {
  aws: "bg-warning/15 text-warning border-warning/30",
  azure: "bg-info/15 text-info border-info/30",
  gcp: "bg-accent/15 text-accent border-accent/30",
  kubernetes: "bg-purple/15 text-purple border-purple/30",
  "entra-id": "bg-muted/15 text-muted-foreground border-border",
};

export default function CloudCredentialsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [vaultSource, setVaultSource] = useState<string>("dev-ephemeral");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Form
  const [provider, setProvider] = useState<string>("aws");
  const [label, setLabel] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Activation: bridge a stored credential into ~/.aws so the Cloud Controller uses it.
  const [activating, setActivating] = useState<string | null>(null);
  const [activateMsg, setActivateMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const activate = async (id: string) => {
    setActivating(id); setActivateMsg(null);
    try {
      const res = await fetch(`/api/cloud-credentials/${id}/activate`, { method: "POST" });
      const d = await res.json();
      setActivateMsg({ id, ok: !!d.ok, text: d.ok ? `Active for Cloud Lab → ${d.identity || d.account} · ${d.region}` : (d.error || "activation failed") });
      if (d.ok) fetchAll();
    } catch (e: any) { setActivateMsg({ id, ok: false, text: e?.message || "activation failed" }); }
    finally { setActivating(null); }
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cloud-credentials");
      const data = await res.json();
      setRows(data.items || []);
      setVaultSource(data.vaultSource || "dev-ephemeral");
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const submit = async () => {
    if (!label) { setError("Label required"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/cloud-credentials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider, label,
          accessKeyId, secretKey, sessionToken,
          configJson: JSON.stringify(region ? { region } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Save failed"); return; }
      setAdding(false);
      setLabel(""); setAccessKeyId(""); setSecretKey(""); setSessionToken(""); setRegion("");
      await fetchAll();
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this credential?")) return;
    await fetch(`/api/cloud-credentials/${id}`, { method: "DELETE" });
    await fetchAll();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back navigation — users reach this page from Deploy → Cloud Lab. Offer a
          deterministic link there, plus a generic "go back" for other entry points. */}
      <div className="flex items-center gap-3">
        <Link href="/deploy?view=cloud"
          className="inline-flex items-center gap-1.5 text-xs font-medium rounded-md border border-border px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Cloud Lab
        </Link>
        <button onClick={() => router.back()}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Go back
        </button>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-accent" />
          Cloud Credentials
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Used by the Stratus runtime to execute cloud-native attack techniques. Credentials are AES-256-GCM
          encrypted at rest. Prefer short-lived STS / session-token creds over long-lived keys.
        </p>
      </div>

      {/* Vault status */}
      <div className={cn("rounded-md border px-4 py-2.5 text-xs flex items-center gap-2",
        vaultSource === "env" ? "border-success/30 bg-success/10 text-success" :
        vaultSource === "dev-ephemeral" ? "border-warning/30 bg-warning/10 text-warning" :
        "border-danger/30 bg-danger/10 text-danger",
      )}>
        {vaultSource === "env" ? <Shield className="h-4 w-4" /> :
         vaultSource === "dev-ephemeral" ? <ShieldQuestion className="h-4 w-4" /> :
         <ShieldAlert className="h-4 w-4" />}
        <span className="font-medium">Vault:</span>
        {vaultSource === "env" && <>Production-ready (CREDENTIAL_VAULT_KEY set)</>}
        {vaultSource === "dev-ephemeral" && (
          <>Ephemeral process key — credentials become unreadable on restart. Set
             <code className="mx-1 font-mono">CREDENTIAL_VAULT_KEY</code> in <code className="font-mono">.env</code> (32+ chars) for durable storage.</>
        )}
        {vaultSource === "unconfigured" && <>CREDENTIAL_VAULT_KEY not configured</>}
      </div>

      {/* Add form */}
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-accent text-white hover:bg-[#60a5fa] text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> Add credential
        </button>
      )}
      {adding && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Add cloud credential</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Provider">
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent">
                {PROVIDERS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
              </select>
            </Field>
            <Field label="Label">
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="prod sandbox AWS account"
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
            <Field label={provider === "aws" ? "Access Key ID" : "Identity / Key"}>
              <input type="text" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder={provider === "aws" ? "AKIAxxxxxxxx" : ""}
                className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
            <Field label="Secret">
              <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
                placeholder="••••••••"
                className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
            <Field label="Session Token (STS, optional)" wide>
              <input type="password" value={sessionToken} onChange={(e) => setSessionToken(e.target.value)}
                placeholder="(for short-lived creds)"
                className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
            </Field>
            {provider === "aws" && (
              <Field label="Region (optional)">
                <input type="text" value={region} onChange={(e) => setRegion(e.target.value)}
                  placeholder="us-east-1"
                  className="w-full px-2 py-1.5 text-xs font-mono rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent" />
              </Field>
            )}
          </div>
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /> {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setAdding(false); setError(null); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            <button onClick={submit} disabled={busy || !label}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded bg-accent text-white hover:bg-[#60a5fa] disabled:opacity-50">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Save credential
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Saved credentials ({rows.length})</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            No credentials yet. Add one above to enable Stratus execution.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border", PROVIDER_BG[r.provider])}>
                      {r.provider}
                    </span>
                    <span className="text-sm font-medium text-foreground truncate">{r.label}</span>
                    {r.accessKeyTail && (
                      <span className="text-[10px] font-mono text-muted-foreground">key {r.accessKeyTail}</span>
                    )}
                    {r.hasSessionToken && (
                      <span className="text-[10px] text-success">STS</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Created {new Date(r.createdAt).toLocaleString()}
                    {r.lastUsedAt && <> · Last used {new Date(r.lastUsedAt).toLocaleString()}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.provider === "aws" && (
                    <button
                      onClick={() => activate(r.id)}
                      disabled={activating === r.id}
                      title="Write these credentials to ~/.aws so the Cloud Controller build uses them, and validate with AWS STS"
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50"
                    >
                      {activating === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Use for Cloud Lab
                    </button>
                  )}
                  <button
                    onClick={() => remove(r.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-danger/30 text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            ))}
            {activateMsg && (
              <div className={cn("px-4 py-2 text-[11px] flex items-start gap-1.5",
                activateMsg.ok ? "text-success" : "text-danger")}>
                {activateMsg.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                <span>{activateMsg.text}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn("block", wide && "md:col-span-2")}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">{label}</span>
      {children}
    </label>
  );
}
