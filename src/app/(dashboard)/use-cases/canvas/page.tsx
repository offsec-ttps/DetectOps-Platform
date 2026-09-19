"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Workflow, Loader2 } from "lucide-react";
// Eagerly load React Flow styles at the page boundary so they're in the
// document before the canvas client component mounts (avoids the missing-
// styles dev warning when the bundle splits across chunks).
import "@xyflow/react/dist/style.css";

const WorkflowCanvas = dynamic(
  () => import("@/components/use-cases/canvas/WorkflowCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading canvas…
      </div>
    ),
  },
);

export default function WorkflowCanvasPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-3">
      <Link href="/use-cases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Use Cases
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Workflow className="h-6 w-6 text-info" />
            Workflow Canvas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag ART tests, PurpleSharp variations, and Stratus attacks onto the canvas. Connect them to form a DAG.
            Compile to ordered steps, then export to any framework.
          </p>
        </div>
      </div>

      <WorkflowCanvas />
    </div>
  );
}
