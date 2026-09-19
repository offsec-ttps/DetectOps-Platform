/**
 * UseCase → PurpleSharp JSON playbook.
 *
 * Verified shape (from PurpleTeamPlaybook/Emulation Playbooks/Conti/*):
 *   {
 *     type: "local" | "remote",
 *     sleep: <int>,
 *     playbooks: [{
 *       name: <string>,
 *       enabled: <bool>,
 *       task_sleep: <int>,
 *       tasks: [{
 *         technique_id: "T1003.001",
 *         technique_name: "...",
 *         variation: <int>,
 *         url?: <string>,
 *         command?: <string>
 *       }]
 *     }]
 *   }
 *
 * Strategy: a single UseCase becomes ONE outer playbook (named after the
 * UseCase), wrapped in the standard root object. Non-purplesharp steps are
 * skipped with a warning. Per-step parameters are read from
 * `parameters.purplesharp.{variation,url,command}`.
 */

import { createHash } from "node:crypto";
import type { StepParameters, PurpleSharpPlaybookInput } from "@/lib/use-cases/types";

export interface PurpleSharpExportInput {
  useCase: {
    id: string;
    name: string;
    description: string;
  };
  steps: Array<{
    id: string;
    kind: string;
    techniqueId: string;
    displayName: string;
    parameters: string;                     // JSON string
  }>;
  // Optional root-level config; we default sensibly otherwise.
  rootConfig?: {
    type?: "local" | "remote";
    sleep?: number;
    task_sleep?: number;
  };
}

export interface PurpleSharpExportResult {
  body: string;
  checksum: string;
  skippedKinds: Record<string, number>;
  emittedTasks: number;
}

function safeParseParams(s: string): StepParameters {
  try { return JSON.parse(s) as StepParameters; } catch { return {}; }
}

function sha256Short(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

export function exportPurpleSharpJson(input: PurpleSharpExportInput): PurpleSharpExportResult {
  const psSteps = input.steps.filter((s) => s.kind === "purplesharp");
  const skipped: Record<string, number> = {};
  for (const s of input.steps.filter((s) => s.kind !== "purplesharp")) {
    skipped[s.kind] = (skipped[s.kind] || 0) + 1;
  }

  const tasks = psSteps.map((s) => {
    const params = safeParseParams(s.parameters);
    const p = params.purplesharp || { variation: 1 };
    const t: Record<string, unknown> = {
      technique_id: s.techniqueId,
      technique_name: s.displayName,
      variation: typeof p.variation === "number" ? p.variation : 1,
    };
    if (p.url) t.url = p.url;
    if (p.command) t.command = p.command;
    return t;
  });

  const playbook: PurpleSharpPlaybookInput = {
    type: input.rootConfig?.type ?? "local",
    sleep: input.rootConfig?.sleep ?? 5,
    playbooks: [
      {
        name: input.useCase.name,
        enabled: true,
        task_sleep: input.rootConfig?.task_sleep ?? 3,
        // Cast: validated above
        tasks: tasks as PurpleSharpPlaybookInput["playbooks"][number]["tasks"],
      },
    ],
  };

  const body = JSON.stringify(playbook, null, 2) + "\n";
  return {
    body,
    checksum: sha256Short(body),
    skippedKinds: skipped,
    emittedTasks: tasks.length,
  };
}
