"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, FileCode2, Loader2 } from "lucide-react";

const PurpleSharpBuilder = dynamic(
  () => import("@/components/use-cases/purplesharp/PurpleSharpBuilder"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading PurpleSharp builder…
      </div>
    ),
  },
);

export default function PurpleSharpBuilderPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Use Cases
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FileCode2 className="h-6 w-6 text-purple" />
            PurpleSharp Playbook Builder
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build PurpleSharp JSON playbooks. Load curated PurpleTeamPlaybook templates or compose from scratch using
            the 54-technique catalogue parsed from upstream.
          </p>
        </div>
      </div>

      <PurpleSharpBuilder />
    </div>
  );
}
