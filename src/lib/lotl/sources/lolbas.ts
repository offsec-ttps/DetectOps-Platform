/**
 * LOLBAS ingestor — Living Off The Land Binaries, Scripts and Libraries.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/lolbas.py.
 *
 * Source: https://github.com/LOLBAS-Project/LOLBAS — one YAML per binary under
 * yml/{OSBinaries,OSLibraries,OSScripts,OtherMSBinaries}. Each documented
 * Command becomes one normalized entry.
 */

import yaml from "js-yaml";
import type { LotlIngestor } from "../base";
import type { NormalizedEntry, LotlRisk } from "../types";
import { fetchTree, fetchRaw, pMap, rawUrl } from "../github";

const YML_DIRS = ["OSBinaries", "OSLibraries", "OSScripts", "OtherMSBinaries"];
const MATCH = new RegExp(`^yml/(${YML_DIRS.join("|")})/.*\\.yml$`, "i");

// Category → risk level (from lolbas.py risk_map).
const RISK_MAP: Record<string, LotlRisk> = {
  Execute: "high",
  Download: "medium",
  "AWL Bypass": "high",
  ADS: "medium",
  Encode: "low",
  Decode: "low",
  Copy: "low",
  Compile: "medium",
  Credentials: "high",
  Dump: "high",
  Reconnaissance: "low",
  Upload: "medium",
};

interface LolbasYaml {
  Name?: string;
  Description?: string;
  Full_Path?: Array<{ Path?: string } | string>;
  Commands?: Array<{
    Command?: string;
    Description?: string;
    MitreID?: string;
    Usecase?: string;
    Category?: string;
    Privileges?: string;
  }>;
}

export class LolbasIngestor implements LotlIngestor {
  readonly sourceId = "lolbas";
  readonly displayName = "LOLBAS";
  readonly description = "Living Off The Land Binaries, Scripts, and Libraries";
  readonly repo = "LOLBAS-Project/LOLBAS";
  readonly branch = "master";
  readonly repoUrl = "https://github.com/LOLBAS-Project/LOLBAS";
  readonly platform = "windows";

  async collect(): Promise<NormalizedEntry[]> {
    const { items } = await fetchTree(this.repo, this.branch, (p) => MATCH.test(p));
    const parsed = await pMap(
      items,
      async (item) => {
        try {
          const content = await fetchRaw(this.repo, this.branch, item.path);
          const url = rawUrl(this.repo, this.branch, item.path);
          return this.parseFile(item.path, content).map((e) => ({ ...e, sourceUrl: url }));
        } catch {
          return [];
        }
      },
      20,
    );
    return parsed.flat();
  }

  private parseFile(path: string, content: string): NormalizedEntry[] {
    let data: LolbasYaml | null = null;
    try {
      data = yaml.load(content) as LolbasYaml;
    } catch {
      return [];
    }
    if (!data || !data.Commands || data.Commands.length === 0) return [];

    const name = data.Name || "";
    const description = data.Description || "";

    // First usable Full_Path becomes the binary path hint.
    let binaryPath: string | null = null;
    for (const p of data.Full_Path || []) {
      const val = typeof p === "string" ? p : p?.Path;
      if (val && val !== "N/A") {
        binaryPath = val;
        break;
      }
    }

    const out: NormalizedEntry[] = [];
    data.Commands.forEach((cmd, idx) => {
      const command = cmd?.Command || "";
      if (!command || command === "N/A") return;

      const techniqueId = cmd.MitreID || "";
      const usecase = cmd.Usecase || "";
      const category = cmd.Category || "";

      const lower = command.toLowerCase();
      const executor = lower.startsWith("powershell") || lower.includes("invoke-") ? "powershell" : "cmd";
      const riskLevel = RISK_MAP[category] || "medium";

      out.push({
        sourceRef: `${name}#${idx}`,
        name: usecase ? `${name} - ${usecase}` : name,
        description: category ? `${description} (${category})` : description,
        command,
        executor,
        techniqueId,
        binaryPath,
        elevationRequired: false,
        riskLevel,
        platforms: ["windows"],
        cleanupCommand: null,
        metadata: { category, usecase, source_file: name },
      });
    });
    return out;
  }
}
