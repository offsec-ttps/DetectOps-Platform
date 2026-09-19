"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, FlaskConical, Loader2 } from "lucide-react";

// MUI doesn't SSR cleanly with React 19 + Next 16 in dev; load client-only.
const AtomicBuilder = dynamic(
  () => import("@/components/use-cases/atomic/AtomicBuilder"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading ART builder…
      </div>
    ),
  },
);

export default function AtomicBuilderPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Use Cases
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-accent" />
            Atomic Red Team Builder
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Field-by-field visual editor with live YAML preview. Save persists a UseCase you can export later.
          </p>
        </div>
      </div>

      <AtomicBuilder />
    </div>
  );
}
