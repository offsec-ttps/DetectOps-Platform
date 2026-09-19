/**
 * SentinelFlow Pipeline API client.
 *
 * All calls go through /api/sentinel/* which Next.js rewrites to the FastAPI backend.
 * This keeps the frontend decoupled from the backend URL.
 */

const BASE = "/api/sentinel";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SentinelFlow API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Types ──

export interface TechniqueInput {
  technique_id: string;
  sigma_rule_path?: string;
  sigma_rule_content?: string;
}

export interface TriggerRequest {
  techniques: TechniqueInput[];
  attack_range_id?: string;
  target_server?: string;
  siem_targets?: "splunk" | "mde" | "both";
  lab_provider?: "local" | "aws" | "azure" | "gcp";
  auto_report?: boolean;
  detection_window_minutes?: number;
}

export interface TriggerResponse {
  run_id: string;
  status: string;
  message: string;
  techniques_count: number;
}

export interface SimulationResult {
  technique_id: string;
  status: string;
  art_output?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
}

export interface ValidationResult {
  technique_id: string;
  siem: string;
  translated_query?: string;
  result_count: number;
  raw_log_count: number;
  verdict: string;
  query_time_seconds?: number;
  error?: string;
}

export interface ReliabilityScore {
  technique_id: string;
  p_data: number;
  p_logic: number;
  p_ingest: number;
  rd: number;
  failure_class?: string;
}

export interface ReportResult {
  lock_markdown?: string;
  branch_name?: string;
  pr_url?: string;
  pr_number?: number;
  error?: string;
}

export interface PipelineStatus {
  run_id: string;
  status: string;
  attack_range_id?: string;
  progress: Record<string, number>;
  simulations: SimulationResult[];
  validations: ValidationResult[];
  scores: ReliabilityScore[];
  report?: ReportResult;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  error?: string;
}

export interface PipelineRunSummary {
  run_id: string;
  status: string;
  techniques_count: number;
  created_at: string;
  completed_at?: string;
  error?: string;
}

export interface HealthStatus {
  status: string;
  version: string;
  services: Record<string, string>;
}

// ── API methods ──

export async function triggerPipeline(req: TriggerRequest): Promise<TriggerResponse> {
  return request<TriggerResponse>("/pipeline/trigger", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function getPipelineStatus(runId: string): Promise<PipelineStatus> {
  return request<PipelineStatus>(`/pipeline/${runId}/status`);
}

export async function generateReport(runId: string): Promise<{ run_id: string; report: ReportResult }> {
  return request(`/pipeline/${runId}/report`, {
    method: "POST",
    body: JSON.stringify({ pipeline_run_id: runId }),
  });
}

export async function listPipelineRuns(
  status?: string,
  limit = 50,
  offset = 0
): Promise<{ total: number; runs: PipelineRunSummary[] }> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return request(`/pipeline/runs?${params}`);
}

export async function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>("/health");
}

export async function listLabRanges(): Promise<{ ranges: Record<string, unknown>[] }> {
  return request("/lab/ranges");
}

export async function provisionRange(
  provider = "local",
  config?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({ provider });
  return request(`/lab/ranges?${params}`, {
    method: "POST",
    body: config ? JSON.stringify(config) : undefined,
  });
}

export async function destroyRange(rangeId: string): Promise<Record<string, unknown>> {
  return request(`/lab/ranges/${rangeId}`, { method: "DELETE" });
}

export async function translateSigma(
  sigmaYaml: string,
  target: "splunk" | "mde" = "splunk"
): Promise<{ target: string; queries: string[]; count: number }> {
  const params = new URLSearchParams({ sigma_yaml: sigmaYaml, target });
  return request(`/translate?${params}`, { method: "POST" });
}
