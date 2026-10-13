/**
 * LOLAPI ingestor — Living Off The Land API abuse catalog.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/lolapi.py.
 *
 * Source: https://github.com/TheMagicClaw/LOLAPI — one YAML per API under
 * yaml/. Each entry has one or more abuse_scenarios with a code_snippet and
 * (optionally) a MITRE technique id. Unlike LOLBAS (binaries), LOLAPI tracks
 * the programmatic API surface (.NET, COM, Win32, cloud metadata, browser).
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry, LotlRisk, LotlExecutor } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

const MATCH = /^yaml\/.*\.yaml$/;

const CATEGORY_PLATFORMS: Record<string, string[]> = {
  "windows-dotnet-api": ["windows"],
  "windows-com-api": ["windows"],
  "windows-com": ["windows"],
  "windows-api": ["windows"],
  "windows-native-api": ["windows"],
  "script-engine": ["windows"],
  "script-engine-api": ["windows"],
  "cloud-metadata": ["linux", "windows"],
  "browser-extension": ["windows", "linux", "macos"],
};

const SUBCATEGORY_TECHNIQUE_FALLBACK: Record<string, string> = {
  "process-execution": "T1106", "process-injection": "T1055", "code-execution": "T1059",
  "script-execution": "T1059", "shell-execution": "T1059", "module-loading": "T1129",
  "memory-access": "T1055.001", "network-communication": "T1071", "network-interception": "T1557",
  "command-and-control": "T1071", "lateral-movement": "T1021", "persistence": "T1547",
  "evasion": "T1027", "data-exfiltration": "T1041", "token-theft": "T1528",
  "authentication": "T1078", "registry-manipulation": "T1112", "registry-access": "T1012",
  "log-manipulation": "T1070", "file-operations": "T1005", "hooking": "T1056",
  "api-resolution": "T1106", "inter-process-communication": "T1559", "resource-retrieval": "T1105",
};

const SEVERITY_TO_RISK: Record<string, LotlRisk> = { critical: "high", high: "high", medium: "medium", low: "low" };

const ELEVATED_SUBCATS = new Set(["process-injection", "memory-access", "hooking", "log-manipulation", "registry-manipulation"]);
const ELEVATION_INDICATORS = [
  "VirtualAllocEx", "WriteProcessMemory", "CreateRemoteThread", "NtCreateThreadEx",
  "OpenProcess", "SeDebugPrivilege", "AdjustTokenPrivileges", "sudo ", "runas ",
];

function resolveExecutor(language: string, code: string): LotlExecutor {
  const l = (language || "").toLowerCase();
  const c = (code || "").toLowerCase();
  if (l.includes("powershell") || c.includes("powershell")) return "powershell";
  if (l.includes("javascript")) return "manual";
  if (l.includes("http") || c.startsWith("curl ")) return "bash";
  if (l.includes("bash") || l.includes("shell")) return "bash";
  if (l.includes("python")) return "bash";
  if (l.includes("vbscript")) return "cmd";
  if (["c#", ".net", "c/c++"].some((kw) => l.includes(kw))) return "manual";
  return "manual";
}

function needsElevation(code: string, subcategory: string, category: string): boolean {
  if (ELEVATED_SUBCATS.has(subcategory)) return true;
  if (category === "windows-native-api") return true;
  return ELEVATION_INDICATORS.some((ind) => code.includes(ind));
}

export class LolapiIngestor implements LotlIngestor {
  readonly sourceId = "lolapi";
  readonly displayName = "LOLAPI";
  readonly description =
    "Living Off The Land APIs — catalog of legitimate system APIs weaponized for attack across Windows, cloud, and browser platforms";
  readonly repo = "TheMagicClaw/LOLAPI";
  readonly branch = "main";
  readonly repoUrl = "https://github.com/TheMagicClaw/LOLAPI";
  readonly platform = "multi";

  async collect(): Promise<NormalizedEntry[]> {
    const { items } = await fetchTree(this.repo, this.branch, (p) => MATCH.test(p));
    const parsed = await pMap(
      items,
      async (item) => {
        try {
          const content = await fetchRaw(this.repo, this.branch, item.path);
          const url = rawUrl(this.repo, this.branch, item.path);
          return this.parseEntry(content).map((e) => ({ ...e, sourceUrl: url }));
        } catch {
          return [];
        }
      },
      20,
    );
    return parsed.flat();
  }

  private parseEntry(content: string): NormalizedEntry[] {
    let data: any;
    try { data = yaml.load(content); } catch { return []; }
    if (!data) return [];

    const apiName: string = data.name || "";
    const category: string = data.category || "";
    const subcategory: string = data.subcategory || "";
    const api = data.api || {};
    const namespace: string = api.namespace || "";
    const apiClass: string = api.class || "";
    const apiMethod: string = api.method || "";
    const apiLanguage: string = api.language || "";

    const risk = data.risk || {};
    const severity: string = risk.severity || "medium";
    const riskLevel: LotlRisk = SEVERITY_TO_RISK[severity] || "medium";

    const platforms = CATEGORY_PLATFORMS[category] || ["windows"];
    const refs = data.references || {};
    const entryTechniqueIds: string[] = refs.techniques || [];

    const scenarios: any[] = data.abuse_scenarios || [];
    if (scenarios.length === 0) return [];

    const out: NormalizedEntry[] = [];
    scenarios.forEach((scenario, idx) => {
      const scenarioName: string = scenario.name || `Scenario ${idx + 1}`;
      const code: string = scenario.code_snippet || "";
      if (!code || ["", "N/A"].includes(code.trim())) return;

      const techniqueId =
        scenario.technique_id || (entryTechniqueIds[0] || "") || SUBCATEGORY_TECHNIQUE_FALLBACK[subcategory] || "T1106";
      const detectionDifficulty: string = scenario.detection_difficulty || "medium";
      const commonInCampaigns: boolean = !!scenario.common_in_campaigns;
      const executor = resolveExecutor(apiLanguage, code);

      let effectiveRisk: LotlRisk = riskLevel;
      if (commonInCampaigns && riskLevel !== "high") effectiveRisk = riskLevel === "medium" ? "high" : "medium";

      const desc = `${scenario.description || ""} [API: ${namespace}${apiClass ? "." + apiClass : ""}${apiMethod ? "." + apiMethod : ""} | Detection difficulty: ${detectionDifficulty}]`.trim();

      out.push({
        sourceRef: `${data.id || apiName}#${idx}`,
        name: `LOLAPI: ${apiName} - ${scenarioName}`,
        description: desc,
        command: code,
        executor,
        techniqueId,
        binaryPath: null,
        elevationRequired: needsElevation(code, subcategory, category),
        riskLevel: effectiveRisk,
        platforms,
        cleanupCommand: null,
        metadata: {
          source: "lolapi", api_name: apiName, category, subcategory, namespace,
          class: apiClass, method: apiMethod, language: apiLanguage, severity,
          detection_difficulty: detectionDifficulty, common_in_campaigns: commonInCampaigns,
          tools: refs.tools || [], threat_actors: refs.threat_actors || [],
          lolapi_id: data.id || "", verified: !!data.verified,
        },
      });
    });
    return out;
  }
}
