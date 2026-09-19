/**
 * SIEM provider abstraction for Simulation & Detection.
 *
 * Each simulation environment (Local Lab / Cloud Lab / Fleet / C2) validates
 * detection against its OWN SIEM connection. A provider knows how to test a
 * connection and run one detection query (SPL for Splunk, KQL for MDE) over a
 * time window, returning a normalized verdict the Campaign Designer renders.
 */

export type SiemKind = "splunk" | "mde";

/** Resolved, decrypted connection config passed to providers. */
export interface SplunkConfig {
  kind: "splunk";
  url: string;                 // REST base, e.g. https://host:8089
  authMode: "token" | "basic";
  username?: string;
  token?: string;              // bearer / HEC token
  password?: string;           // basic-auth (admin) password
}
export interface MdeConfig {
  kind: "mde";
  tenantId: string;
  clientId: string;
  clientSecret: string;
}
export type SiemConfig = SplunkConfig | MdeConfig;

export interface DetectionQuery {
  query: string;               // SPL (splunk) or KQL (mde)
  detectionName?: string;
  techniqueId?: string;
  windowMinutes?: number;      // look-back window (default 30)
}

export interface DetectionStrategy {
  strategy: string;
  found: boolean;
  resultCount: number;
  details: string;
  results?: unknown[];
}

export interface SiemDetectionResult {
  detected: boolean;
  resultCount: number;
  strategies: DetectionStrategy[];
  diagnostics: string[];
  summary: string;
}

export interface SiemTestResult {
  ok: boolean;
  detail?: string;             // e.g. "Splunk 9.1.2 · serverName" or "MDE tenant reachable"
  error?: string;
}

export interface SiemProvider {
  kind: SiemKind;
  displayName: string;
  /** Query language the provider expects (for the UI label + conversion). */
  language: "spl" | "kql";
  test(cfg: SiemConfig): Promise<SiemTestResult>;
  runDetection(cfg: SiemConfig, opts: DetectionQuery): Promise<SiemDetectionResult>;
}
