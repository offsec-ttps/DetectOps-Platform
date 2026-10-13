/**
 * LOTL ingestion types.
 *
 * `NormalizedEntry` mirrors the Magic-Atomics `PreventionTest` dict
 * (magicsword-io/Magic-Atomics backend/app/ingestion/base.py) so the ported
 * per-source ingestors map 1:1 onto the platform's `LotlTechnique` model.
 */

export type LotlExecutor = "cmd" | "powershell" | "bash" | "manual";
export type LotlRisk = "low" | "medium" | "high";

export interface NormalizedEntry {
  /** Stable, unique-within-library id derived from the upstream entry. */
  sourceRef: string;
  name: string;
  description: string;
  command: string;
  executor: LotlExecutor;
  /** MITRE ATT&CK technique id, "" when the source does not map cleanly. */
  techniqueId: string;
  techniqueName?: string;
  tactic?: string;
  binaryPath?: string | null;
  elevationRequired: boolean;
  riskLevel: LotlRisk;
  platforms: string[];
  cleanupCommand?: string | null;
  metadata: Record<string, unknown>;
  /** Upstream link for this entry; sync stores it on the row. */
  sourceUrl?: string;
}

export interface LotlSyncResult {
  library: string;
  newCount: number;
  updatedCount: number;
  removedCount: number;
  totalTests: number;
  commitSha: string;
  errors: string[];
}
