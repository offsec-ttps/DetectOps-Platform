"use client";

/**
 * Connect a SIEM for Simulation & Detection — Splunk (SPL) or Microsoft Defender
 * for Endpoint (MDE, KQL via Graph Advanced Hunting). Secrets are sent once and
 * stored AES-GCM encrypted server-side. Mirrors the C2 ServerModal pattern.
 */

import { useState } from "react";
import { X, Loader2, ShieldCheck, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SiemConnectModal({ defaultScope, onClose, onCreated }: {
  defaultScope?: string; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [kind, setKind] = useState<"splunk" | "mde">(defaultScope === "fleet" || defaultScope === "c2" ? "mde" : "splunk");
  const [name, setName] = useState("");
  const [scope, setScope] = useState(defaultScope || "any");
  // Splunk
  const [url, setUrl] = useState("");
  const [authMode, setAuthMode] = useState<"token" | "basic">("token");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  // MDE
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const body: any = { name: name.trim(), kind, scope, isDefault: true };
      if (kind === "splunk") { body.url = url.trim(); body.authMode = authMode; if (authMode === "token") body.token = token.trim(); else { body.username = username.trim(); body.password = password; } }
      else { body.tenantId = tenantId.trim(); body.clientId = clientId.trim(); body.clientSecret = clientSecret; }
      const r = await fetch("/api/siem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "failed"); return; }
      // Best-effort test so the user sees connectivity immediately.
      await fetch(`/api/siem/${d.connection.id}/test`, { method: "POST" }).catch(() => {});
      onCreated(d.connection.id);
    } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(false); }
  };

  const field = "mt-1 w-full px-2 py-1.5 text-xs rounded border border-border bg-input text-foreground focus:outline-none focus:border-accent";
  const canSubmit = name.trim() && (kind === "splunk"
    ? (url.trim() && (authMode === "token" ? token.trim() : password))
    : (tenantId.trim() && clientId.trim() && clientSecret));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-purple" /> Connect a SIEM</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["splunk", "mde"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cn("px-3 py-1 text-[11px] font-medium", kind === k ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground hover:text-foreground")}>
              {k === "splunk" ? "Splunk" : "Microsoft Defender (MDE)"}
            </button>
          ))}
        </div>

        <label className="block text-[11px] text-muted-foreground">Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "mde" ? "acme-mde-prod" : "acme-splunk"} className={field} />
        </label>
        <label className="block text-[11px] text-muted-foreground">Environment scope
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={field}>
            <option value="any">Any</option><option value="local">Local Lab</option><option value="cloud">Cloud Lab</option><option value="fleet">Fleet Simulation</option><option value="c2">C2</option>
          </select>
        </label>

        {kind === "splunk" ? (
          <>
            <label className="block text-[11px] text-muted-foreground">Splunk REST URL
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://splunk-host:8089" className={cn(field, "font-mono")} />
            </label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {(["token", "basic"] as const).map((a) => (
                <button key={a} onClick={() => setAuthMode(a)} className={cn("px-2.5 py-1 text-[10px] font-medium", authMode === a ? "bg-accent/15 text-accent" : "bg-card text-muted-foreground")}>{a === "token" ? "Auth token" : "User / password"}</button>
              ))}
            </div>
            {authMode === "token" ? (
              <label className="block text-[11px] text-muted-foreground">Splunk auth / HEC token
                <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token from Splunk" className={cn(field, "font-mono")} />
              </label>
            ) : (
              <div className="flex gap-2">
                <label className="block text-[11px] text-muted-foreground flex-1">User<input value={username} onChange={(e) => setUsername(e.target.value)} className={cn(field, "font-mono")} /></label>
                <label className="block text-[11px] text-muted-foreground flex-1">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={cn(field, "font-mono")} /></label>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info">Azure AD app registration with Graph <span className="font-mono">ThreatHunting.Read.All</span> (admin-consented). Queries run via Advanced Hunting (KQL).</div>
            <label className="block text-[11px] text-muted-foreground">Tenant ID<input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className={cn(field, "font-mono")} /></label>
            <label className="block text-[11px] text-muted-foreground">Client ID<input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="app registration (client) id" className={cn(field, "font-mono")} /></label>
            <label className="block text-[11px] text-muted-foreground">Client secret<input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="client secret value" className={cn(field, "font-mono")} /></label>
          </>
        )}

        {error && <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-xs h-8 px-3 rounded border border-border text-muted-foreground">Cancel</button>
          <button onClick={submit} disabled={busy || !canSubmit} className="inline-flex items-center gap-1.5 text-xs h-8 px-3 rounded bg-purple text-white hover:bg-purple/90 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Connect &amp; test
          </button>
        </div>
      </div>
    </div>
  );
}
