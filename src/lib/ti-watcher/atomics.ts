/**
 * Atomic linkage for TI-watcher contributions.
 *
 * Policy (confirmed): LINK existing, vetted AtomicTest rows only; flag gaps.
 * We NEVER auto-generate executable attack commands here — an unlinked
 * contribution is marked `needsAtomic` and surfaces as reference-only until an
 * analyst authors/links a test.
 */

import { prisma } from "@/lib/prisma";

export interface AtomicLink {
  atomicTestId: string | null;
  atomicTestName: string | null;
  atomicTestNumber: number | null;
  needsAtomic: boolean;
}

const UNLINKED: AtomicLink = { atomicTestId: null, atomicTestName: null, atomicTestNumber: null, needsAtomic: true };

/**
 * Find the most on-point existing AtomicTest for an ATT&CK id. Prefers
 * `source:"upstream"` (vetted redcanaryco tests) and the lowest testNumber for
 * determinism. Returns an unlinked result when no test exists.
 */
export async function linkAtomic(techniqueId: string): Promise<AtomicLink> {
  if (!/^T\d{4}(\.\d{3})?$/.test(techniqueId)) return UNLINKED;
  const rows = await prisma.atomicTest.findMany({
    where: { techniqueId },
    orderBy: [{ source: "asc" }, { testNumber: "asc" }], // "custom" < "upstream" alphabetically, so pick explicitly below
    select: { id: true, testName: true, testNumber: true, source: true },
  }).catch(() => []);
  if (!rows.length) return UNLINKED;
  const best = rows.find((r) => r.source === "upstream") ?? rows[0];
  return { atomicTestId: best.id, atomicTestName: best.testName, atomicTestNumber: best.testNumber, needsAtomic: false };
}
