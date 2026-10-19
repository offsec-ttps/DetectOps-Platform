/**
 * PurpleSharp (github.com/mvelazc0/PurpleSharp) adversary-simulation capability map.
 *
 * PurpleSharp is a Windows AD adversary-simulation binary that executes ATT&CK
 * techniques natively (richer domain telemetry than a generic atomic). It is
 * installed on fleet endpoints next to Atomic Red Team by the agent prepare
 * script (C:\ProgramData\AtomicRedTeam\PurpleSharp\PurpleSharp.exe).
 *
 * This is the set of ATT&CK techniques PurpleSharp supports (its enabled Navigator
 * layer — 47 techniques, parents + sub-techniques). The attack-catalog view uses
 * it to offer PurpleSharp as an alternative engine where it overlaps Atomic Red
 * Team, and as the ONLY engine for AD techniques that have no atomic test.
 */
export const PURPLESHARP_TECHNIQUES: ReadonlySet<string> = new Set([
  "T1053", "T1059", "T1569", "T1136", "T1197", "T1543", "T1546", "T1547", "T1134",
  "T1055", "T1070", "T1218", "T1140", "T1220", "T1003", "T1110", "T1558", "T1135",
  "T1046", "T1087", "T1007", "T1033", "T1049", "T1016", "T1018", "T1083", "T1482",
  "T1201", "T1069", "T1012", "T1518", "T1082", "T1124", "T1021", "T1047",
  "T1053.005", "T1059.001", "T1059.003", "T1059.005", "T1059.007", "T1569.002",
  "T1136.001", "T1543.003", "T1546.003", "T1547.001", "T1134.004", "T1055.002",
  "T1055.004", "T1055.003", "T1070.001", "T1218.003", "T1218.010", "T1218.004",
  "T1218.005", "T1218.009", "T1218.011", "T1003.001", "T1110.003", "T1558.003",
  "T1087.001", "T1087.002", "T1069.001", "T1069.002", "T1518.001", "T1021.002",
  "T1021.006",
]);

/** A technique is PurpleSharp-runnable if its exact ID, or its parent technique, is supported. */
export function purpleSharpSupports(techniqueId: string): boolean {
  if (!techniqueId) return false;
  if (PURPLESHARP_TECHNIQUES.has(techniqueId)) return true;
  const parent = techniqueId.split(".")[0];
  return PURPLESHARP_TECHNIQUES.has(parent);
}
