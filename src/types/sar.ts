/**
 * TypeScript mirrors of the Splunk Attack Range (SAR) Docker controller's
 * OpenAPI schema at http://localhost:4000/openapi.json.
 * Pure types — no runtime. Keep in sync with upstream when bumping attack_range.
 */

export type SarProvider = "aws" | "azure" | "gcp";

export type SarStatus =
  | "queued"
  | "build_vpn"
  | "wait_for_vpn"
  | "build_lab"
  | "running"
  | "completed"
  | "failed"
  | "error"
  | "aborted";

export interface SarArchitectureServer {
  name: string;
  instance_type: string | null;
  ip_last_octet: number | null;
  os_type: string | null; // "linux" | "windows"
  roles: string[] | null;
  zeek: boolean | null;
  zeek_monitor: boolean | null;
}

export interface SarTemplateInfo {
  name: string; // "splunk_minimal_aws.yml"
  path: string; // full container path
  provider: SarProvider;
  description: string | null;
  architecture: SarArchitectureServer[] | null;
  /** Whether the provider CLI is installed & authenticated in the SAR container */
  provider_available?: boolean;
}

export interface SarTemplateListResponse {
  templates: SarTemplateInfo[];
}

export interface SarTemplateContentResponse {
  name: string;
  provider: SarProvider;
  content: Record<string, unknown>;
}

export interface SarCloudFieldOption {
  label: string;
  type: "select" | "text" | "number";
  required: boolean;
  options?: string[];
  default?: string;
}

export interface SarCloudFieldsResponse {
  provider: SarProvider;
  fields: Record<string, SarCloudFieldOption>;
}

export interface SarProviderAvailability {
  provider: SarProvider;
  cli_command: string; // "aws" | "az" | "gcloud"
  available: boolean;
  error_message: string | null;
}

export interface SarProviderCheckResponse {
  providers: SarProviderAvailability[];
}

export interface SarBuildRequest {
  template?: string | null;
  attack_range_id?: string | null;
  general_overrides?: Record<string, unknown> | null;
  cloud_overrides?: Record<string, Record<string, unknown>> | null;
}

export interface SarBuildResponse {
  status: string;
  message: string;
  attack_range_id: string;
  phase: string; // "vpn" | "lab"
}

export interface SarDefaultCredential {
  service: string; // "SSH" | "splunk" | "guacamole" | "RDP" ...
  server?: string;
  username: string;
  password: string;
}

export interface SarGuacamoleServer {
  name: string;
  hostname: string;
  port: number;
  protocol: string; // "ssh" | "rdp"
  username: string;
  password: string;
}

export interface SarGuacamoleInfo {
  host_ip: string;
  servers: SarGuacamoleServer[];
}

export interface SarOperationResult {
  attack_range_id?: string;
  config_file?: string;
  architecture?: SarArchitectureServer[];
  default_credentials?: SarDefaultCredential[];
  guacamole_info?: SarGuacamoleInfo;
  [key: string]: unknown;
}

export interface SarOperationStatus {
  type: string; // "build" | "destroy"
  status: SarStatus;
  created_time: string;
  start_time?: string | null;
  end_time?: string | null;
  attack_range_id?: string | null;
  attack_range_name?: string | null;
  template_name?: string | null;
  router_public_ip?: string | null;
  wireguard_config?: string | null;
  wireguard_config_path?: string | null;
  sharing?: Record<string, string> | null;
  result?: SarOperationResult | null;
  error?: string | null;
  error_phase?: string | null;
  traceback?: string | null;
}

export interface SarShareRequest {
  attack_range_id: string;
  name: string;
}

export interface SarShareResponse {
  name: string;
  config: string;
  message: string;
}

export interface SarUpdateNameRequest {
  attack_range_id: string;
  attack_range_name: string;
}

export interface SarUpdateNameResponse {
  status: string;
  message: string;
  attack_range_id: string;
  attack_range_name: string;
}

export interface SarAttackRangeListResponse {
  attack_ranges: SarOperationStatus[];
}

export interface SarDestroyRequest {
  attack_range_id: string;
}

export interface SarDestroyResponse {
  status: string;
  message: string;
}

export interface SarSuggestedIpResponse {
  ip: string;
  cidr: string; // "1.2.3.4/32"
}

export interface SarHealthResponse {
  status: string; // "healthy"
  version: string;
}

/** Set of statuses where polling can stop. */
export const SAR_TERMINAL_STATUSES: ReadonlySet<SarStatus> = new Set([
  "running",
  "completed",
  "failed",
  "error",
  "aborted",
] as const);

export function isSarTerminal(status: SarStatus): boolean {
  return SAR_TERMINAL_STATUSES.has(status);
}
