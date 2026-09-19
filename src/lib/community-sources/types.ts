/**
 * Community Content Source Adapter Interface
 *
 * NEW sources (MITRE CAR, Sentinel, Defender XDR, Google SecOps, Panther,
 * Falco, Wazuh) implement this interface and write into the unified
 * `community_rules` table via the registry.
 *
 * EXISTING sources (SigmaHQ, Elastic, Splunk, Atomic Red Team) keep their
 * dedicated tables and bespoke sync modules. They are wrapped by adapters
 * for discovery in the unified Community Content UI but their sync paths
 * remain untouched.
 */

export type RuleLanguage =
  | "sigma"
  | "spl"
  | "kql"
  | "eql"
  | "lucene"
  | "esql"
  | "yara-l"
  | "python"
  | "falco-yaml"
  | "wazuh-xml"
  | "pseudocode"
  | "toml"
  | "yaml"
  | "json";

export type RuleType =
  | "detection"
  | "hunting"
  | "analytic"
  | "policy"
  | "correlation"
  | "scheduled"
  | "behavior";

export type SourceCategory =
  | "sigma-native"
  | "siem-native"
  | "edr-hunting"
  | "cloud-siem"
  | "runtime-security"
  | "host-ids"
  | "analytic-reference";

/** Normalized rule shape produced by every adapter. */
export interface NormalizedRule {
  upstreamRuleId: string | null;
  title: string;
  description: string;
  author: string;
  upstreamCreatedAt: Date | null;
  upstreamModifiedAt: Date | null;
  mitreTechniques: string[];
  mitreTactics: string[];
  platforms: string[];
  products: string[];
  logSources: string[];
  tags: string[];
  ruleLanguage: RuleLanguage;
  ruleType: RuleType;
  detectionLogicRaw: string;
  conversionSupported: boolean;
  severity: string;
  status: string;
  references: string[];
  falsePositives: string[];
  sourceFilePath: string;
  sourceUrl: string;
  rawPayload: Record<string, unknown>;
}

export interface SyncResult {
  newCount: number;
  modifiedCount: number;
  deletedCount: number;
  totalAfterSync: number;
  errors: { file?: string; message: string }[];
}

/** Snapshot returned by GET endpoints for the registry. */
export interface SourceStatus {
  id: string;
  name: string;
  type: string;
  category: SourceCategory;
  description: string;
  url: string;
  enabled: boolean;
  registered: boolean; // present in CommunitySource table
  totalRules: number;
  lastSyncAt: string | null;
  capabilities: {
    sigmaConvertible: boolean;
    nativeUI: boolean; // has its own dedicated /community/<x> page
  };
}

/**
 * Adapter contract.
 *
 * Required:
 *   - meta()       — describes the source for the UI registry
 *   - sync()       — pulls upstream rules and stores them (in unified table or legacy table)
 *
 * Optional:
 *   - status()     — fast read of current state (defaults to DB lookup)
 *   - check()      — peek upstream commit SHA without doing a full sync
 */
export interface ICommunitySourceAdapter {
  meta(): {
    id: string;       // stable slug e.g. "mitre-car"
    name: string;     // display name
    type: string;     // sigmahq | elastic | splunk | mitre-car | sentinel | ...
    category: SourceCategory;
    url: string;
    description: string;
    sigmaConvertible: boolean;
    nativeUI: boolean; // does this source have its own dedicated page?
    legacy: boolean;  // true = uses legacy bespoke table; false = uses unified community_rules
  };
  sync(): Promise<SyncResult>;
  status?(): Promise<Partial<SourceStatus>>;
  check?(): Promise<{ updateAvailable: boolean; currentSha?: string; latestSha?: string }>;
}
