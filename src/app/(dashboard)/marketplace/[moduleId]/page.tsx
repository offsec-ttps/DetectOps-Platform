"use client";

/**
 * Module detail — manifest, permissions, dependencies, version history,
 * validation status, and install/uninstall/approve actions.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Blocks, Loader2, ChevronLeft, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Trash2, Play, BadgeCheck, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CHK: Record<string, string> = { pass: "text-success", warn: "text-warning", fail: "text-danger" };

export default function ModuleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const moduleId = String(params.moduleId || "");
  const [m, setM] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    const d = await fetch(`/api/modules/${moduleId}`).then((r) => r.ok ? r.json() : null).catch(() => null);
    setM(d); setLoading(false);
  };
  useEffect(() => { load(); }, [moduleId]);

  const act = async (kind: string) => {
    setBusy(kind);
    try {
      if (kind === "uninstall") {
        await fetch(`/api/modules/${moduleId}`, { method: "DELETE" });
        router.push("/marketplace"); return;
      }
      if (kind === "install") await fetch(`/api/modules/${moduleId}/install`, { method: "POST" });
      if (kind === "approve") await fetch(`/api/modules/${moduleId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approve" }) });
      if (kind === "reject") await fetch(`/api/modules/${moduleId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "reject" }) });
      await load();
    } finally { setBusy(""); }
  };

  if (loading) return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!m || m.error) return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Marketplace</Link>
      <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-6 text-sm text-danger">Module not found.</div>
    </div>
  );

  const perms = m.permissions || {};
  const val = m.validation;
  const manifest = m.manifest || {};
  const deps = manifest.dependencies || [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <Link href="/marketplace" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="h-3.5 w-3.5" /> Marketplace</Link>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent"><Blocks className="h-6 w-6" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            {m.name}
            <span className={cn("text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border", m.status === "live" ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground")}>{m.status}</span>
            {m.signatureState === "verified" && <span className="inline-flex items-center gap-1 text-[10px] text-success"><ShieldCheck className="h-3 w-3" /> signed</span>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
          <div className="mt-1 text-[11px] text-muted-foreground font-mono">{m.moduleId} · v{m.version} · {m.category} · by {m.author}</div>
        </div>
        <div className="flex flex-col gap-2">
          {m.status === "live" && <Link href={`/modules/${m.moduleId}`} className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-accent text-white px-3 py-1.5 hover:bg-[#60a5fa]"><Play className="h-3 w-3" /> Open &amp; run</Link>}
          {m.status === "approved" && <button onClick={() => act("approve")} disabled={!!busy} className="inline-flex items-center gap-1 text-[11px] font-medium rounded-md bg-success text-white px-3 py-1.5 hover:opacity-90 disabled:opacity-50"><BadgeCheck className="h-3 w-3" /> Approve → live</button>}
          {(m.status === "approved" || m.status === "submitted") && <button onClick={() => act("reject")} disabled={!!busy} className="inline-flex items-center gap-1 text-[11px] rounded-md border border-danger/40 text-danger px-3 py-1.5 hover:bg-danger/10 disabled:opacity-50"><Ban className="h-3 w-3" /> Reject</button>}
          <button onClick={() => act("uninstall")} disabled={!!busy} className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border text-muted-foreground px-3 py-1.5 hover:text-danger disabled:opacity-50"><Trash2 className="h-3 w-3" /> Uninstall</button>
        </div>
      </div>

      {/* Validation status */}
      {val && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold text-foreground mb-2">AI validation — verdict: <span className={cn("uppercase", val.verdict === "auto-approve" ? "text-success" : val.verdict === "reject" ? "text-danger" : "text-warning")}>{val.verdict || "—"}</span></div>
          <div className="space-y-1">
            {(val.checks || []).map((c: any) => (
              <div key={c.name} className="flex items-start gap-2 text-[11px]">
                {c.status === "pass" ? <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5" /> : c.status === "warn" ? <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5" /> : <XCircle className="h-3.5 w-3.5 text-danger mt-0.5" />}
                <span className="font-mono text-foreground">{c.name}</span>
                <span className={cn("uppercase font-bold", CHK[c.status])}>{c.status}</span>
                <span className="text-muted-foreground">— {c.detail}</span>
              </div>
            ))}
          </div>
          {val.aiReview?.rationale && <div className="mt-2 text-[11px] text-muted-foreground border-t border-border pt-2"><span className="font-semibold text-foreground">AI reviewer:</span> {val.aiReview.rationale}{(val.aiReview.concerns || []).length ? ` (concerns: ${val.aiReview.concerns.join(", ")})` : ""}</div>}
        </div>
      )}

      {/* Permissions + deps */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-semibold text-foreground mb-2">Declared capabilities</div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {(perms.frameworks || []).map((f: string) => <span key={f} className="px-2 py-0.5 rounded-md border border-border bg-muted/10 text-muted-foreground font-mono">fw: {f}</span>)}
            {(perms.integrations || []).map((f: string) => <span key={f} className="px-2 py-0.5 rounded-md border border-border bg-muted/10 text-muted-foreground font-mono">integ: {f}</span>)}
            {!(perms.frameworks || []).length && <span className="text-muted-foreground">none declared</span>}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs font-semibold text-foreground mb-2">Dependencies</div>
          {deps.length === 0 ? <span className="text-[11px] text-muted-foreground">none</span> : (
            <div className="space-y-1 text-[11px] font-mono text-muted-foreground">{deps.map((d: any) => <div key={d.name}>{d.name} {d.version}</div>)}</div>
          )}
        </div>
      </div>

      {/* Version history */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold text-foreground mb-2">Version history</div>
        <div className="space-y-1 text-[11px]">
          {(m.versions || []).map((v: any) => (
            <div key={v.version} className="flex items-center gap-2 text-muted-foreground">
              <span className="font-mono text-foreground">v{v.version}</span>
              <span className={cn("uppercase text-[9px] font-bold", v.status === "published" ? "text-success" : v.status === "yanked" ? "text-danger" : "")}>{v.status}</span>
              {v.changelog && <span>— {v.changelog}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
