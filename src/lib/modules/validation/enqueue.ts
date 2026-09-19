/**
 * Idempotent enqueue of a module validation run (mirrors detection-packs/enqueue).
 * The @@unique([moduleRowId, version]) on ModuleValidationRun makes re-submits safe.
 */

import { prisma } from "@/lib/prisma";

export async function enqueueValidationRun(opts: { moduleRowId: string; version: string }): Promise<{ created: boolean; id: string }> {
  const existing = await prisma.moduleValidationRun.findUnique({
    where: { moduleRowId_version: { moduleRowId: opts.moduleRowId, version: opts.version } },
  });
  if (existing) {
    // Re-queue a previously-finished run for the same version (re-validate).
    if (existing.status === "queued" || existing.status === "running") return { created: false, id: existing.id };
    const reset = await prisma.moduleValidationRun.update({
      where: { id: existing.id },
      data: { status: "queued", attempts: 0, checks: "[]", aiReview: "{}", dryRunResults: "[]", verdict: "", errorMessage: null, startedAt: null, completedAt: null },
    });
    return { created: false, id: reset.id };
  }
  const row = await prisma.moduleValidationRun.create({
    data: { moduleRowId: opts.moduleRowId, version: opts.version, status: "queued" },
  });
  return { created: true, id: row.id };
}
