/**
 * Anthropic tool definitions (input schemas) shared across generators.
 *
 * Every generator passes ONE of these to `runTool` and gets back the parsed
 * `input` typed to the schema. The model is forced to call the tool; if it
 * refuses we error out.
 */

import type { AnthropicTool } from "@/lib/llm/anthropic";

const ART_TEST_SCHEMA = {
  type: "object",
  required: ["attack_technique", "display_name", "name", "description", "supported_platforms", "executor"],
  properties: {
    attack_technique: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
    display_name:     { type: "string" },
    name:             { type: "string" },
    description:      { type: "string" },
    supported_platforms: {
      type: "array",
      items: { type: "string", enum: [
        "windows", "macos", "linux",
        "office-365", "azure-ad", "google-workspace",
        "saas", "iaas", "containers",
        "iaas:gcp", "iaas:azure", "iaas:aws",
      ] },
      minItems: 1,
    },
    input_arguments: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type"],
        properties: {
          name:        { type: "string" },
          type:        { type: "string", enum: ["path", "string", "url", "integer", "boolean"] },
          description: { type: "string" },
          default:     { type: "string" },
        },
      },
    },
    executor: {
      type: "object",
      required: ["name", "elevation_required"],
      properties: {
        name:               { type: "string", enum: ["powershell", "command_prompt", "bash", "sh", "manual"] },
        elevation_required: { type: "boolean" },
        command:            { type: "string" },
        cleanup_command:    { type: "string" },
        steps:              { type: "string" },
      },
    },
    expected_signal: { type: "string", description: "Telemetry an analyst should see (Sysmon EID, Windows event ID, etc.)" },
  },
} as const;

export const emit_atomic_test: AnthropicTool = {
  name: "emit_atomic_test",
  description: "Emit a single Atomic Red Team YAML test. Use to generate one test from a prompt or technique.",
  input_schema: ART_TEST_SCHEMA as unknown as Record<string, unknown>,
};

export const emit_atomic_playbook: AnthropicTool = {
  name: "emit_atomic_playbook",
  description: "Emit an ART playbook covering the threat: a name + N technique tests, each grounded in published ART coverage where possible.",
  input_schema: {
    type: "object",
    required: ["name", "tests"],
    properties: {
      name:        { type: "string" },
      description: { type: "string" },
      tests: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: ART_TEST_SCHEMA,
      },
    },
  } as unknown as Record<string, unknown>,
};

export const emit_purplesharp_playbook: AnthropicTool = {
  name: "emit_purplesharp_playbook",
  description: "Emit a PurpleSharp playbook covering the threat. Each task picks a (technique_id, variation) supported by the PurpleSharp CLI.",
  input_schema: {
    type: "object",
    required: ["name", "tasks"],
    properties: {
      name:        { type: "string" },
      description: { type: "string" },
      type:        { type: "string", enum: ["local", "remote"] },
      sleep:       { type: "integer", minimum: 0, maximum: 300 },
      task_sleep:  { type: "integer", minimum: 0, maximum: 60 },
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          required: ["technique_id", "technique_name", "variation", "rationale"],
          properties: {
            technique_id:   { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
            technique_name: { type: "string" },
            variation:      { type: "integer", minimum: 1, maximum: 10 },
            rationale:      { type: "string" },
            url:            { type: "string" },
            command:        { type: "string" },
            expected_signal:{ type: "string" },
          },
        },
      },
    },
  } as unknown as Record<string, unknown>,
};

// ─── Detection Pack pipeline (Phase 1) ───────────────────────────────────────

const DETECTION_RULE_SCHEMA = {
  type: "object",
  required: ["format", "title", "body"],
  properties: {
    format: {
      type: "string",
      enum: ["sigma", "spl", "kql", "elastic-eql", "elastic-lucene", "yara", "falco", "wazuh"],
      description: "Detection-format identifier; pick the canonical one for the engine you target.",
    },
    title:    { type: "string", description: "Short human-readable rule title." },
    body:     { type: "string", description: "Full rule text. YAML for sigma, SPL for spl, KQL/EQL for kql/eql, YARA-L for yara." },
    language: { type: "string", description: "Optional refinement (sigma|kuery|lucene|eql|spl|yara-l|…)." },
    falsePositives: { type: "array", items: { type: "string" }, description: "Known FP triggers, one per item." },
  },
} as const;

export const emit_detection_pack: AnthropicTool = {
  name: "emit_detection_pack",
  description:
    "Emit a complete Detection Pack: platform-categorised metadata + multi-format detection rules + references. " +
    "Every rule must be runnable as-is in its target engine. Prefer high-coverage formats (Sigma, SPL) and add others only when they add unique coverage.",
  input_schema: {
    type: "object",
    required: ["pack"],
    properties: {
      pack: {
        type: "object",
        required: ["name", "description", "severity", "riskScore", "category", "platforms", "dataSources", "mitreTechniques", "rules"],
        properties: {
          name:        { type: "string", description: "Short, concrete pack name. Avoid generic phrases." },
          description: { type: "string", description: "1-3 sentence summary of what this detects + why it matters." },
          severity:    { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
          riskScore:   { type: "integer", minimum: 0, maximum: 100, description: "Composite risk; align with severity." },
          category: {
            type: "string",
            enum: ["web", "network", "os-windows", "os-linux", "os-macos", "cloud", "identity", "email", "third-party", "other"],
            description: "Primary platform category — pick the dominant one.",
          },
          platforms: {
            type: "array",
            items: { type: "string", enum: ["windows", "linux", "macos", "office-365", "azure-ad", "google-workspace", "saas", "iaas", "containers", "iaas:aws", "iaas:azure", "iaas:gcp", "network"] },
            minItems: 1,
          },
          dataSources: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            description: "Telemetry sources required (Sysmon, Windows Security Log, CloudTrail, AAD signin logs, Zeek, EDR process events, …).",
          },
          mitreTechniques: {
            type: "array",
            items: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
            minItems: 1,
          },
          mitreTactics: {
            type: "array",
            items: { type: "string" },
            description: "Tactic names from MITRE ATT&CK (e.g. credential-access, lateral-movement).",
          },
          references: {
            type: "array",
            items: {
              type: "object",
              required: ["title", "url", "type"],
              properties: {
                title: { type: "string" },
                url:   { type: "string" },
                type:  { type: "string", enum: ["report", "blog", "advisory", "community", "vendor", "other"] },
              },
            },
          },
          rules: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: DETECTION_RULE_SCHEMA,
            description: "1-8 detection rules across formats. Each must be runnable as-is.",
          },
        },
      },
    },
  } as unknown as Record<string, unknown>,
};

const IR_STEP_SCHEMA = {
  type: "object",
  required: ["order", "title", "action", "expectedFinding"],
  properties: {
    order:           { type: "integer", minimum: 1, maximum: 50 },
    title:           { type: "string", description: "Imperative one-line step title." },
    action:          { type: "string", description: "Concrete commands or UI clicks the analyst performs." },
    expectedFinding: { type: "string", description: "What the analyst should see / record from this step." },
    escalateIf:      { type: "string", description: "Hand-off condition to the next tier (or 'none')." },
    references:      { type: "array", items: { type: "string" }, description: "Helper URLs / runbook links." },
  },
} as const;

export const emit_ir_playbook: AnthropicTool = {
  name: "emit_ir_playbook",
  description:
    "Emit an Incident Response Playbook tied to a Detection Pack. Three tiers (L1/L2/L3) of structured steps + containment, eradication, recovery checklists. " +
    "L1 = triage + initial scoping; L2 = investigation + initial response; L3 = deep forensics + persistence/root-cause + lessons learned.",
  input_schema: {
    type: "object",
    required: ["summary", "l1Steps", "l2Steps", "l3Steps", "containment", "eradication", "recovery"],
    properties: {
      summary:     { type: "string", description: "One paragraph framing the incident for an on-call analyst." },
      l1Steps:     { type: "array", minItems: 3, maxItems: 12, items: IR_STEP_SCHEMA },
      l2Steps:     { type: "array", minItems: 3, maxItems: 12, items: IR_STEP_SCHEMA },
      l3Steps:     { type: "array", minItems: 3, maxItems: 12, items: IR_STEP_SCHEMA },
      containment: { type: "array", minItems: 1, maxItems: 10, items: IR_STEP_SCHEMA },
      eradication: { type: "array", minItems: 1, maxItems: 10, items: IR_STEP_SCHEMA },
      recovery:    { type: "array", minItems: 1, maxItems: 10, items: IR_STEP_SCHEMA },
    },
  } as unknown as Record<string, unknown>,
};

// ─── SigmaGen multi-agent pipeline ───────────────────────────────────────────

const SIGMAGEN_PLATFORM_ENUM = ["windows", "linux", "macos", "office-365", "azure-ad", "google-workspace", "saas", "iaas", "containers", "iaas:aws", "iaas:azure", "iaas:gcp", "network"];

export const emit_intel_extract: AnthropicTool = {
  name: "emit_intel_extract",
  description:
    "Extract a COMPLETE structured threat-intelligence profile from unstructured source material (report / blog / advisory / IOC dump). " +
    "Capture the attack profile, full timeline, every IOC (normalised by type), all CVEs, threat-actor attribution, mitigations, references, and candidate MITRE ATT&CK techniques — each with a detection opportunity. Be exhaustive: extract everything the source states or clearly implies.",
  input_schema: {
    type: "object",
    required: ["summary", "attackProfile", "candidateTechniques"],
    properties: {
      summary: { type: "string", description: "3-5 sentence executive summary of the threat." },
      attackProfile: {
        type: "object",
        description: "Structured profile of the attack.",
        required: ["overview"],
        properties: {
          overview: { type: "string", description: "What the attack does end-to-end." },
          objective: { type: "string", description: "Adversary goal (e.g. ransomware deployment, espionage, data theft)." },
          sophistication: { type: "string", enum: ["low", "moderate", "high", "advanced", "unknown"] },
          killChainSummary: { type: "string", description: "Narrative across initial-access → actions-on-objective." },
          affectedProducts: { type: "array", items: { type: "string" }, description: "Vendors/products/versions affected (e.g. 'Check Point Security Gateway R81')." },
        },
      },
      threatActor: {
        type: "object",
        description: "Attribution. Leave name empty if the source does not name an actor — do NOT invent one.",
        properties: {
          name: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          attribution: { type: "string", description: "Basis for attribution / who attributes it." },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          motivation: { type: "string" },
          nationState: { type: "string" },
        },
      },
      malwareFamilies: { type: "array", items: { type: "string" } },
      targetedSectors: { type: "array", items: { type: "string" } },
      targetedRegions: { type: "array", items: { type: "string" } },
      cves: {
        type: "array",
        description: "Every CVE/CDE referenced or clearly implied.",
        items: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", pattern: "^(CVE|CDE)-\\d{4}-\\d{4,7}$" },
            description: { type: "string" },
            cvssScore: { type: "number", minimum: 0, maximum: 10 },
            affected: { type: "string", description: "Affected product/version." },
          },
        },
      },
      timeline: {
        type: "array",
        description: "Ordered attack timeline reconstructed from the source.",
        items: {
          type: "object",
          required: ["order", "event"],
          properties: {
            order: { type: "integer", minimum: 1, maximum: 50 },
            timeframe: { type: "string", description: "Absolute or relative time (e.g. 'Day 0 09:14', 'T+2h', '2024-06-01'); empty if unknown." },
            event: { type: "string", description: "What happened at this step." },
            techniqueId: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$", description: "Associated ATT&CK technique, if any." },
          },
        },
      },
      iocs: {
        type: "object",
        description: "ALL indicators, normalised by type and defanged values refanged (e.g. evil[.]com → evil.com). Empty arrays where none.",
        properties: {
          ipv4: { type: "array", items: { type: "string" } },
          ipv6: { type: "array", items: { type: "string" } },
          domains: { type: "array", items: { type: "string" } },
          urls: { type: "array", items: { type: "string" } },
          hashes: { type: "array", items: { type: "string" }, description: "MD5/SHA1/SHA256 file hashes." },
          emails: { type: "array", items: { type: "string" } },
          registry: { type: "array", items: { type: "string" }, description: "Registry keys/values." },
          filePaths: { type: "array", items: { type: "string" } },
          other: { type: "array", items: { type: "string" }, description: "Mutexes, JA3, user-agents, etc." },
        },
      },
      mitigations: {
        type: "array",
        description: "Mitigation / remediation recommendations — from the source plus standard best-practice for the techniques involved.",
        items: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            mitreMitigationId: { type: "string", description: "ATT&CK mitigation id (M####) if applicable." },
          },
        },
      },
      candidateTechniques: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        description: "EVERY technique/sub-technique mentioned or implied. Prefer sub-techniques when the source is specific.",
        items: {
          type: "object",
          required: ["techniqueId", "evidence"],
          properties: {
            techniqueId: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
            techniqueName: { type: "string" },
            tactic: { type: "string", description: "ATT&CK tactic (e.g. execution, credential-access)." },
            evidence: { type: "string", description: "Quote/paraphrase from the source justifying this mapping." },
            detectionOpportunity: { type: "string", description: "Concrete way to detect this behaviour (telemetry + logic hint)." },
          },
        },
      },
      references: {
        type: "array",
        description: "Preserve EVERY source/reference URL plus authoritative links (vendor advisories, NVD for CVEs, ATT&CK pages).",
        items: {
          type: "object",
          required: ["title", "url", "type"],
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            type: { type: "string", enum: ["report", "blog", "advisory", "community", "vendor", "nvd", "mitre", "other"] },
          },
        },
      },
    },
  } as unknown as Record<string, unknown>,
};

export const emit_attack_mapping: AnthropicTool = {
  name: "emit_attack_mapping",
  description:
    "Produce COMPLETE MITRE ATT&CK coverage for the threat: validate/correct every candidate, ADD techniques/sub-techniques the source implies but the first pass missed, de-duplicate, and for EACH technique give the tactic, confidence, evidence, required data sources, and a detection opportunity. Aim for full coverage across the kill chain, not a partial subset.",
  input_schema: {
    type: "object",
    required: ["techniques"],
    properties: {
      techniques: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          required: ["techniqueId", "techniqueName", "tactic", "confidence", "detectionOpportunity"],
          properties: {
            techniqueId: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
            techniqueName: { type: "string" },
            tactic: { type: "string", description: "ATT&CK tactic slug (e.g. initial-access, execution, persistence, defense-evasion, credential-access, lateral-movement, command-and-control, exfiltration, impact)." },
            isSubTechnique: { type: "boolean" },
            parentTechnique: { type: "string", pattern: "^T\\d{4}$", description: "Parent id when this is a sub-technique." },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            evidence: { type: "string" },
            dataSources: { type: "array", items: { type: "string" }, description: "Telemetry needed to detect (e.g. 'Sysmon EID 1', 'Windows Security 4624', 'CloudTrail')." },
            detectionOpportunity: { type: "string", description: "How to detect this technique in practice." },
          },
        },
      },
      coverageNotes: { type: "string", description: "Brief note on coverage completeness / any techniques deliberately excluded." },
    },
  } as unknown as Record<string, unknown>,
};

const USE_CASE_STEP_SCHEMA = {
  type: "object",
  required: ["order", "techniqueId", "name", "action"],
  properties: {
    order: { type: "integer", minimum: 1, maximum: 30 },
    techniqueId: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
    name: { type: "string", description: "Imperative step title." },
    action: { type: "string", description: "What the adversary executes at this step." },
    expectedSignal: { type: "string", description: "Telemetry an analyst should see (Sysmon EID, Windows event id, log source field)." },
  },
} as const;

export const emit_use_cases: AnthropicTool = {
  name: "emit_use_cases",
  description:
    "Generate detection use cases from the mapped techniques. Produce MULTIPLE realistic scenarios when the threat supports it (e.g. initial-access attempt → successful unauthorized access → post-access activity); at minimum one high-quality use case. Each use case is fully specified: objective, scenario, ATT&CK mappings, required log sources, detection logic, validation procedure, and expected alerts/outcomes.",
  input_schema: {
    type: "object",
    required: ["useCases"],
    properties: {
      useCases: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          required: ["name", "detectionObjective", "scenarioDescription", "mitreTechniques", "logSources", "detectionLogic", "steps"],
          properties: {
            name: { type: "string", description: "Concrete scenario name (e.g. 'Check Point VPN Authentication Bypass — Initial Attempt')." },
            detectionObjective: { type: "string", description: "What this detection is trying to catch and why it matters." },
            scenarioDescription: { type: "string", description: "Narrative of the attack scenario being detected." },
            mitreTechniques: { type: "array", items: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" }, minItems: 1 },
            mitreTactics: { type: "array", items: { type: "string" } },
            platforms: { type: "array", items: { type: "string", enum: SIGMAGEN_PLATFORM_ENUM } },
            logSources: { type: "array", items: { type: "string" }, minItems: 1, description: "Specific log sources required (e.g. 'Check Point VPN logs', 'Sysmon EID 1', 'Windows Security 4625')." },
            detectionLogic: { type: "string", description: "Narrative of the detection logic — the conditions/correlation that fire the alert." },
            validationProcedure: { type: "string", description: "How to validate the detection works (run the simulation, confirm the alert)." },
            expectedAlerts: { type: "array", items: { type: "string" }, description: "Expected alerts / observable outcomes when the activity occurs." },
            steps: { type: "array", minItems: 1, maxItems: 12, items: USE_CASE_STEP_SCHEMA },
          },
        },
      },
    },
  } as unknown as Record<string, unknown>,
};

export const emit_custom_simulation: AnthropicTool = {
  name: "emit_custom_simulation",
  description:
    "Generate a custom adversary-emulation procedure for a technique that has NO suitable Atomic Red Team test. Provide runnable code in the most appropriate executor, a safe cleanup, prerequisites, and the telemetry it should produce so the detection can be validated.",
  input_schema: {
    type: "object",
    required: ["techniqueId", "name", "executor", "command", "expectedTelemetry"],
    properties: {
      techniqueId: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
      name: { type: "string", description: "Short procedure name." },
      description: { type: "string", description: "What the procedure does and how it emulates the technique." },
      platform: { type: "string", enum: ["windows", "linux", "macos", "cloud", "network", "containers"] },
      executor: { type: "string", enum: ["powershell", "bash", "python", "cmd", "manual"] },
      command: { type: "string", description: "The runnable command/script body. Must be self-contained and safe to run in a lab." },
      cleanupCommand: { type: "string", description: "Commands to revert any changes." },
      prerequisites: { type: "string", description: "Required tools/privileges/state." },
      expectedTelemetry: { type: "string", description: "Telemetry/log events the procedure should generate (so the detection can be confirmed)." },
    },
  } as unknown as Record<string, unknown>,
};

export const emit_detection_samples: AnthropicTool = {
  name: "emit_detection_samples",
  description: "Emit detection rule samples (Sigma YAML and/or Splunk SPL) that should fire when the playbook executes.",
  input_schema: {
    type: "object",
    required: ["samples"],
    properties: {
      samples: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          required: ["title", "language", "body", "technique_id"],
          properties: {
            title:        { type: "string" },
            language:     { type: "string", enum: ["sigma", "spl", "kql", "es-lucene", "eql"] },
            body:         { type: "string", description: "Full rule text" },
            technique_id: { type: "string", pattern: "^T\\d{4}(\\.\\d{3})?$" },
            description:  { type: "string" },
            falsepositives: { type: "string" },
          },
        },
      },
    },
  } as unknown as Record<string, unknown>,
};
