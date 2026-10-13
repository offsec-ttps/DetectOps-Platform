/**
 * Dedup helpers for the TI-watcher.
 *
 * A technique is a duplicate when:
 *   1. it is already covered by a hand-curated (static) TechniqueDef in the
 *      target library — any of the target library's techniques already lists
 *      the same primary ATT&CK id; OR
 *   2. a SimLibraryContribution already exists with the same dedupKey (handled
 *      by the @@unique constraint at write time in scan.ts).
 *
 * Case 1 means the library already teaches this behaviour — we skip rather than
 * create a lower-quality auto entry.
 */

import { getLibraryByModule } from "@/lib/attack-sim/registry";
import { getTarget } from "./targets";

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "technique";
}

export function dedupKeyFor(libraryKey: string | null, primaryTechniqueId: string, name: string): string {
  return `${libraryKey ?? "unrouted"}:${primaryTechniqueId.toUpperCase()}:${slug(name)}`;
}

/** True when a static (hand-curated) library technique already covers this ATT&CK id. */
export function coveredByStaticDef(libraryKey: string, primaryTechniqueId: string): boolean {
  const target = getTarget(libraryKey);
  if (!target) return false;
  const lib = getLibraryByModule(target.moduleId);
  if (!lib) return false;
  const id = primaryTechniqueId.toUpperCase();
  return lib.techniques.some((t) => (t.attackTechniques || []).some((a) => a.toUpperCase() === id));
}
