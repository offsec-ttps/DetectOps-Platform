/**
 * Attack Technique Library registry — the single place a new library is wired in.
 *
 * To add the NEXT library:
 *   1. create src/config/attack-libraries/<name>.ts exporting a LibraryDef
 *   2. import it and add it to ATTACK_LIBRARIES below
 *   3. add a ModuleManifest (view "attack-sim") to MODULES in seed-simulations.ts
 * The generic view, chain runner, lure host, API and detection scoring are reused.
 */

import type { LibraryDef, TechniqueDef } from "./types";
import { CLICKFIX_LIBRARY } from "@/config/attack-libraries/clickfix";
import { PROCESS_INJECTION_LIBRARY } from "@/config/attack-libraries/process-injection";

export const ATTACK_LIBRARIES: LibraryDef[] = [
  CLICKFIX_LIBRARY,
  PROCESS_INJECTION_LIBRARY,
];

export function getLibrary(key: string): LibraryDef | null {
  return ATTACK_LIBRARIES.find((l) => l.key === key) || null;
}

export function getLibraryByModule(moduleId: string): LibraryDef | null {
  return ATTACK_LIBRARIES.find((l) => l.moduleId === moduleId) || null;
}

export function getTechnique(libraryKey: string, techniqueKey: string): { library: LibraryDef; technique: TechniqueDef } | null {
  const library = getLibrary(libraryKey);
  if (!library) return null;
  const technique = library.techniques.find((t) => t.key === techniqueKey);
  return technique ? { library, technique } : null;
}
