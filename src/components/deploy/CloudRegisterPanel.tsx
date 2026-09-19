"use client";

/**
 * Cloud "Register for simulation" affordance for the Deploy hub.
 *
 * A cloud SAR range's Splunk sits behind WireGuard, so we can't reliably
 * auto-resolve its endpoint the way the Local flow does. Instead, once a range
 * is up, the user points us at it explicitly here → we register an
 * EnvironmentTarget (+ Splunk SIEM Integration if a host is given) via the same
 * /api/deploy/register endpoint, closing deploy → simulate → detect for cloud.
 */

import { useState } from "react";
import { CheckCircle2, Loader2, Link2, ChevronDown, ChevronRight } from "lucide-react";
import { CLOUD_TEMPLATES } from "@/config/lab-templates";
import { cn } from "@/lib/utils";

export default function CloudRegisterPanel() {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(CLOUD_TEMPLATES[0]?.id || "");
  const [splunkHost, setSplunkHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ notes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const t = CLOUD_TEMPLATES.find((x) => x.id === templateId);
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/deploy/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "cloud", templateId, cloudProvider: t?.cloudProvider, splunkHost: splunkHost.trim() || undefined }),
      });
      const d = await r.json();
      if (d.ok) setResult({ notes: d.notes || [] }); else setError(d.error || "Registration failed");
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card mt-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 p-4 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Link2 className="h-4 w-4 text-accent" />
        <span className="text-sm font-semibold text-foreground">Register a cloud range for simulation</span>
        <span className="text-[11px] text-muted-foreground ml-1">— make a running range a simulation target</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground">Once your range is up, register it so it appears as a target in Fleet Simulation / Campaign Designer. Provide the Splunk host (reachable from this platform, e.g. via WireGuard) to also wire up detection scoring.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Template deployed</span>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
                {CLOUD_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.cloudProvider})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-muted-foreground">Splunk host <span className="opacity-60">(optional, IP/hostname)</span></span>
              <input value={splunkHost} onChange={(e) => setSplunkHost(e.target.value)} placeholder="10.x.x.x or splunk.internal" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground font-mono" />
            </label>
          </div>
          <button onClick={submit} disabled={busy || !templateId} className="inline-flex items-center gap-1.5 rounded-lg bg-accent text-white px-3 py-2 text-xs font-medium hover:bg-[#60a5fa] disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Register for simulation
          </button>
          {error && <div className="text-[11px] text-danger">{error}</div>}
          {result && (
            <div className="rounded-lg border border-success/30 bg-success/10 p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Registered</div>
              {result.notes.map((n, i) => <div key={i} className="text-[11px] text-muted-foreground pl-6">• {n}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
