"use client";

import Link from "next/link";
import { FlaskConical, FileCode2, Workflow, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NewUseCasePage() {
  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Use Cases
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Choose a composition mode</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick how you want to build this use case. Each mode produces a saved UseCase + exportable playbook.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <Card
          href="/use-cases/atomic"
          icon={<FlaskConical className="h-7 w-7" />}
          title="Atomic Red Team"
          subtitle="ART YAML builder"
          bullets={[
            "Field-by-field visual editor",
            "Live YAML preview",
            "Load from atomic-red-team repo",
            "Save → export as ART YAML",
          ]}
        />
        <Card
          href="/use-cases/purplesharp"
          icon={<FileCode2 className="h-7 w-7" />}
          title="PurpleSharp"
          subtitle="Playbook JSON builder"
          bullets={[
            "Header + playbook + task hierarchy",
            "54 techniques · 64 variations · parsed from upstream",
            "Load PurpleTeamPlaybook templates",
            "Save → export as PurpleSharp JSON",
          ]}
        />
        <Card
          href="/use-cases/canvas"
          icon={<Workflow className="h-7 w-7" />}
          title="Workflow Canvas"
          subtitle="Drag-and-drop with connectors"
          bullets={[
            "ART + PurpleSharp + Stratus palette",
            "Connect steps to form a DAG",
            "Compile to ordered steps",
            "Export to ART YAML, PS JSON, or Stratus shell",
          ]}
        />
      </div>
    </div>
  );
}

function Card({ href, icon, title, subtitle, bullets, comingSoon = false }: {
  href: string; icon: React.ReactNode; title: string; subtitle: string; bullets: string[]; comingSoon?: boolean;
}) {
  return (
    <Link
      href={comingSoon ? "#" : href}
      onClick={(e) => { if (comingSoon) e.preventDefault(); }}
      className={cn(
        "group block rounded-2xl border bg-card p-6 transition-all",
        comingSoon
          ? "border-border opacity-50 cursor-not-allowed"
          : "border-border hover:border-accent/40 hover:bg-card-hover hover:shadow-[0_0_40px_rgba(59,130,246,0.08)]",
      )}
    >
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent group-hover:scale-105 transition-transform">
        {icon}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {comingSoon && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning uppercase">soon</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      <ul className="mt-4 space-y-1 text-xs text-foreground">
        {bullets.map((b, i) => (
          <li key={i} className="text-muted-foreground"><span className="text-accent">▸</span> {b}</li>
        ))}
      </ul>
      {!comingSoon && (
        <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent group-hover:gap-2 transition-all">
          Start building <ArrowRight className="h-3.5 w-3.5" />
        </span>
      )}
    </Link>
  );
}
