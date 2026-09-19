// ============================================================================
// Detection Engineering Platform - Core Type Definitions
// ============================================================================

// --- User & Auth ---

/** Platform user roles */
export type UserRole =
  | "detection_engineer"
  | "threat_hunter"
  | "cti_analyst"
  | "soc_analyst"
  | "engineering_lead"
  | "platform_engineer";

/** Permission scopes */
export type Permission =
  | "rules:read" | "rules:write" | "rules:delete" | "rules:deploy"
  | "tests:read" | "tests:write" | "tests:execute"
  | "threat_models:read" | "threat_models:write"
  | "labs:read" | "labs:write" | "labs:manage"
  | "agents:read" | "agents:configure" | "agents:approve"
  | "reports:read" | "reports:write"
  | "settings:read" | "settings:write"
  | "integrations:read" | "integrations:write"
  | "users:read" | "users:write";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  avatarUrl?: string;
  status: "active" | "inactive";
  lastSeenAt: string;
  createdAt: string;
}

export interface Role {
  id: string;
  name: UserRole;
  label: string;
  description: string;
  permissions: Permission[];
}

// --- MITRE ATT&CK & STIX ---

export interface Tactic {
  id: string;
  stixId: string;
  name: string;
  shortName: string;
  description: string;
  url: string;
  order: number;
}

export interface Technique {
  id: string;
  stixId: string;
  name: string;
  description: string;
  tactics: string[];
  platforms: string[];
  dataSources: string[];
  url: string;
  parentId?: string;
  subTechniques?: Technique[];
  /** Detection rules mapped to this technique */
  detectionCount?: number;
  /** Coverage score 0-1 */
  coverageScore?: number;
}

/** STIX Domain Object types relevant to detection engineering */
export type STIXObjectType =
  | "campaign"
  | "intrusion-set"
  | "malware"
  | "attack-pattern"
  | "indicator"
  | "tool"
  | "threat-actor";

export interface STIXObject {
  id: string;
  stixId: string;
  type: STIXObjectType;
  name: string;
  description: string;
  aliases?: string[];
  created: string;
  modified: string;
  /** Related ATT&CK technique IDs */
  relatedTechniques?: string[];
  /** External references (URLs, reports) */
  externalReferences?: { source: string; url: string; description?: string }[];
  labels?: string[];
}

// --- Assets & Threat Models ---

export type AssetType =
  | "server"
  | "endpoint"
  | "cloud_workload"
  | "identity_system"
  | "network_device"
  | "application"
  | "database";

export type Criticality = "critical" | "high" | "medium" | "low";

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  description: string;
  criticality: Criticality;
  owner: string;
  /** ATT&CK technique IDs relevant to this asset */
  relatedTechniques: string[];
  /** Detection coverage score for this asset (0-1) */
  coverageScore: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AttackPathStep {
  step: number;
  techniqueId: string;
  techniqueName: string;
  description: string;
  /** Whether a detection exists for this step */
  covered: boolean;
  /** Linked detection rule IDs */
  detectionRuleIds: string[];
}

export interface ThreatModel {
  id: string;
  name: string;
  description: string;
  priority: Criticality;
  /** Referenced asset IDs */
  assetIds: string[];
  /** Referenced STIX object IDs (campaigns, intrusion sets) */
  stixReferences: string[];
  /** Ordered attack path */
  attackPath: AttackPathStep[];
  /** Overall coverage score (fraction of steps covered) */
  coverageScore: number;
  author: string;
  createdAt: string;
  updatedAt: string;
}

// --- Detection Rules & Lifecycle ---

export type DetectionStatus =
  | "draft"
  | "review"
  | "testing"
  | "active"
  | "deprecated"
  | "archived";

export type Severity =
  | "informational"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type DetectionLifecyclePhase =
  | "threat_modeling"
  | "rule_authoring"
  | "automated_validation"
  | "adversary_emulation"
  | "deployment"
  | "continuous_tuning";

export interface LogSource {
  product: string;
  service: string;
  category: string;
}

export interface MITREMapping {
  tacticId: string;
  tacticName: string;
  techniqueId: string;
  techniqueName: string;
  subTechniqueId?: string;
  subTechniqueName?: string;
}

export interface PlatformQuery {
  platform: "splunk_spl" | "mde_kql" | "elastic_dsl" | "matano_python";
  query: string;
  lastValidated?: string;
}

export interface DetectionRule {
  id: string;
  name: string;
  description: string;
  status: DetectionStatus;
  severity: Severity;
  tags: string[];
  mitreMapping: MITREMapping[];
  logSource: LogSource;
  /** Raw Sigma YAML content */
  sigmaYaml: string;
  /** Platform-specific translated queries */
  platformQueries: PlatformQuery[];
  falsePositives: string[];
  references: string[];
  author: string;
  lifecyclePhase: DetectionLifecyclePhase;
  /** Reliability score Rd = P(Data) × P(Logic) × P(Ingest) */
  reliability: {
    pData: number;
    pLogic: number;
    pIngest: number;
    rd: number;
  };
  /** Number of times tested */
  testCount: number;
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Use Cases ---

export type UseCaseStatus = "planning" | "in_progress" | "complete" | "archived";

export interface UseCase {
  id: string;
  name: string;
  description: string;
  status: UseCaseStatus;
  /** Referenced asset IDs */
  assetIds: string[];
  /** ATT&CK technique IDs */
  techniqueIds: string[];
  /** Linked detection rule IDs */
  detectionRuleIds: string[];
  /** Linked emulation test IDs */
  emulationTestIds: string[];
  /** Threat intel / STIX references */
  stixReferences: string[];
  /** Overall coverage score for this use case */
  coverageScore: number;
  priority: Criticality;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

// --- Community Content ---

export type CommunitySource =
  | "SigmaHQ"
  | "SplunkSecurityContent"
  | "ElasticDetectionRules";

export type ImportStatus = "available" | "imported" | "modified" | "outdated";

export interface CommunityRule {
  id: string;
  source: CommunitySource;
  sourceUrl: string;
  originalId: string;
  title: string;
  description: string;
  severity: Severity;
  technique: string;
  tactic: string;
  author: string;
  tags: string[];
  stars?: number;
  importStatus: ImportStatus;
  /** If imported, the local detection rule ID */
  importedRuleId?: string;
  sourceUpdatedAt: string;
  importedAt?: string;
}

// --- Emulation & Testing ---

export type EmulationFramework = "ART" | "CALDERA" | "Metta" | "RTA";

export interface EmulationTest {
  id: string;
  framework: EmulationFramework;
  techniqueId: string;
  techniqueName: string;
  name: string;
  description: string;
  /** Platform requirements */
  platforms: string[];
  /** Executor type (cmd, powershell, bash, etc.) */
  executor: string;
  /** The test command/script */
  command: string;
  /** Cleanup command */
  cleanupCommand?: string;
  /** Expected telemetry sources */
  expectedTelemetry: string[];
  /** Linked detection rule IDs this test validates */
  detectionRuleIds: string[];
}

export interface CALDERAAbility {
  id: string;
  name: string;
  description: string;
  techniqueId: string;
  tactic: string;
  executor: string;
  command: string;
  platform: string;
}

export interface CALDERAAdversaryProfile {
  id: string;
  name: string;
  description: string;
  abilities: CALDERAAbility[];
  targetPlatforms: string[];
  estimatedDuration: string;
  techniqueIds: string[];
}

export type LabType = "live" | "replay";

export interface LabEnvironment {
  id: string;
  name: string;
  type: LabType;
  provider: string;
  status: "online" | "offline" | "provisioning" | "ready" | "error";
  components: string[];
  /** For live labs */
  ipRange?: string;
  costPerHour?: number;
  /** For replay labs */
  datasets?: number;
  lastActiveAt: string;
  createdAt: string;
}

export type TestRunStatus = "pending" | "running" | "success" | "failure" | "error" | "awaiting_approval";

export interface TestRunResult {
  telemetryCollected: boolean;
  eventsGenerated: number;
  alertsFired: number;
  detectionConfirmed: boolean;
  /** Raw telemetry samples (sanitized) */
  telemetrySamples?: Record<string, unknown>[];
  /** Splunk search results */
  splunkResults?: { searchId: string; matchCount: number; alertTriggered: boolean };
  /** MDE hunting results */
  mdeResults?: { queryId: string; matchCount: number; alertIds: string[] };
}

export interface TestRunStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  output?: string;
}

export interface TestRun {
  id: string;
  /** Linked detection rule */
  ruleId: string;
  ruleName: string;
  /** Linked emulation test */
  testId: string;
  testName: string;
  framework: EmulationFramework;
  techniqueId: string;
  /** Lab used for this run */
  labId: string;
  labName: string;
  status: TestRunStatus;
  steps: TestRunStep[];
  result?: TestRunResult;
  startedAt: string;
  completedAt?: string;
  duration?: string;
  /** Who or what triggered this run */
  triggeredBy: string;
}

// --- CI/CD ---

export type PipelineStageType =
  | "lint"
  | "schema_validation"
  | "unit_test"
  | "volume_test"
  | "deployment";

export type PipelineStageStatus = "success" | "failure" | "running" | "pending" | "skipped";

export interface PipelineStage {
  name: string;
  type: PipelineStageType;
  status: PipelineStageStatus;
  duration?: string;
  details?: string;
}

export type PipelineRunStatus = "success" | "failure" | "running" | "pending" | "cancelled";

export interface PipelineRun {
  id: string;
  name: string;
  branch: string;
  commit: string;
  commitMessage: string;
  author: string;
  status: PipelineRunStatus;
  trigger: "push" | "pull_request" | "schedule" | "manual";
  stages: PipelineStage[];
  startedAt: string;
  completedAt?: string;
  duration: string;
}

export interface CIJob {
  id: string;
  pipelineRunId: string;
  stage: PipelineStageType;
  status: PipelineStageStatus;
  logs: string;
  artifacts?: string[];
  startedAt: string;
  completedAt?: string;
}

// --- Integrations ---

export type IntegrationType =
  | "splunk"
  | "mde"
  | "github"
  | "gitlab"
  | "vector"
  | "tenzir"
  | "substation"
  | "matano"
  | "elastic";

export type IntegrationStatus = "connected" | "disconnected" | "error" | "configuring";

export interface IntegrationConfig {
  id: string;
  type: IntegrationType;
  name: string;
  description: string;
  status: IntegrationStatus;
  endpoint: string;
  lastSyncAt?: string;
  /** Integration-specific config (non-sensitive) */
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SplunkSavedSearch {
  id: string;
  name: string;
  search: string;
  /** Linked detection rule ID */
  ruleId: string;
  cronSchedule: string;
  isEnabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: "success" | "failure" | "no_results";
  resultCount?: number;
}

export interface MDEHuntingQuery {
  id: string;
  name: string;
  query: string;
  /** Linked detection rule ID */
  ruleId: string;
  lastRunAt?: string;
  matchCount?: number;
}

export interface MDEAlert {
  id: string;
  title: string;
  severity: Severity;
  status: "new" | "in_progress" | "resolved";
  category: string;
  deviceName: string;
  /** Linked technique */
  techniqueId?: string;
  createdAt: string;
  resolvedAt?: string;
  files?: { name: string; sha256: string }[];
}

// --- Reporting & Knowledge Management ---

export interface LOCKSection {
  /** Learn: Context from intel/alerts */
  learn: string;
  /** Observe: Hypothesis about adversary behavior */
  observe: string;
  /** Check: Execution details (tests, queries, time ranges) */
  check: string;
  /** Keep: Findings, lessons, links to final rules */
  keep: string;
}

export interface LOCKEntry {
  id: string;
  title: string;
  techniqueId: string;
  tactic: string;
  status: "draft" | "in_progress" | "complete";
  sections: LOCKSection;
  /** Linked detection rule IDs */
  relatedRuleIds: string[];
  /** Linked test run IDs */
  relatedTestRunIds: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface ATHFDocument {
  id: string;
  title: string;
  description: string;
  /** LOCK entries within this document */
  lockEntryIds: string[];
  tags: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface HuntReport {
  id: string;
  title: string;
  hypothesis: string;
  techniques: string[];
  findings: string;
  recommendations: string;
  status: "open" | "closed" | "escalated";
  author: string;
  createdAt: string;
  updatedAt: string;
}

// --- Metrics ---

export interface DetectionMetrics {
  /** Mean Time to Detect (hours) */
  mttd: number;
  /** Mean Time to Implement (hours) */
  mtti: number;
  /** Overall ATT&CK coverage (0-1) */
  coverage: number;
  /** Average reliability across all active rules */
  avgReliability: number;
  totalRules: number;
  activeRules: number;
  totalTests: number;
  successfulTests: number;
}

export interface MetricSnapshot {
  id: string;
  month: string;
  metrics: DetectionMetrics;
  createdAt: string;
}

export interface CoverageMatrixEntry {
  tacticId: string;
  tacticName: string;
  techniqueId: string;
  techniqueName: string;
  /** Coverage level 0-1 */
  coverage: number;
  /** Detection rule IDs providing coverage */
  ruleIds: string[];
  /** Number of emulation tests */
  testCount: number;
}

export interface DetectionDebtItem {
  type: "stale" | "untested" | "noisy" | "missing_coverage";
  label: string;
  description: string;
  severity: "critical" | "warning" | "info";
  /** Affected rule IDs or technique IDs */
  affectedIds: string[];
  affectedNames: string[];
}

// --- Agentic Workflow ---

export type AgentType = "developer" | "simulation" | "validation" | "reporter";

export type AgentRunStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "cancelled";

export interface AgentStep {
  agent: AgentType;
  status: "pending" | "running" | "completed" | "failed" | "awaiting_approval" | "skipped";
  input?: string;
  output?: string;
  startedAt?: string;
  completedAt?: string;
  duration?: string;
  /** If awaiting approval, what action is proposed */
  proposedAction?: string;
  error?: string;
}

export interface AgentRun {
  id: string;
  name: string;
  description: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  /** What triggered this workflow */
  trigger: "manual" | "automated" | "scheduled" | "intel_feed";
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  duration?: string;
  /** Summary of outcomes */
  summary?: string;
}

export type ApprovalPolicy = "auto_approve" | "approve_destructive" | "always_approve";

export interface AgentWorkflowConfig {
  agentType: AgentType;
  enabled: boolean;
  approvalPolicy: ApprovalPolicy;
  /** Max concurrent runs */
  maxConcurrent: number;
  /** Rate limit: max runs per hour */
  maxRunsPerHour: number;
  /** Connected tools/integrations */
  connectedTools: string[];
  model?: string;
}

// --- Pipeline & Data Lake ---

export type PipelineProcessor = "vector" | "tenzir" | "substation" | "custom";

export interface PipelineTransform {
  name: string;
  type: "parse" | "normalize" | "enrich" | "filter" | "route" | "redact";
  description: string;
}

export interface TelemetryPipeline {
  id: string;
  name: string;
  source: string;
  processor: PipelineProcessor;
  destination: string;
  status: "healthy" | "degraded" | "offline" | "maintenance";
  transforms: PipelineTransform[];
  /** Events processed per second */
  eventsPerSec: number;
  /** Processing latency in milliseconds */
  latencyMs: number;
  /** Uptime percentage */
  uptime: string;
  createdAt: string;
  updatedAt: string;
}

export type DataLakeType = "matano" | "elastic" | "splunk" | "s3_iceberg" | "custom";

export interface DataLakeConfig {
  id: string;
  name: string;
  type: DataLakeType;
  description: string;
  storage: string;
  status: "online" | "offline" | "maintenance";
  /** Total data size */
  size: string;
  /** Number of tables/indexes */
  tableCount: number;
  /** Active detection rules running on this lake */
  detectionCount: number;
  retention: string;
  queryCost?: string;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

// --- OODA Cycle ---

export type OODAPhase = "observe" | "orient" | "decide" | "act";

export interface OODAStatus {
  phase: OODAPhase;
  label: string;
  description: string;
  count: number;
  items: string[];
}
