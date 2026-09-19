/**
 * Given uploaded detection content + its sniffed format, build a partial
 * RuleContext (techniques + tactics + logsource + summary) and look up
 * candidate AtomicTest / PurpleSharpVariation / StratusAttack rows that
 * match the inferred techniques.
 *
 * We deliberately do NOT call the LLM here — the upload page shows the
 * mappings as suggestions and the user clicks "Create Use Case" to hand
 * off to either the from-rule generator (LLM) or to drop the suggestions
 * onto the canvas directly.
 */

import { prisma } from "@/lib/prisma";
import { sniffFormat, type UploadedFormat } from "./detect-format";
import { extractTechniqueIds, type RuleContext } from "@/lib/use-cases/parsers/shared";
import * as yaml from "js-yaml";

export interface InferredMappings {
  atomic:      Array<{ techniqueId: string; testGuid: string; testName: string }>;
  purplesharp: Array<{ techniqueId: string; variation: number; variationLabel: string }>;
  stratus:     Array<{ attackId: string; name: string; platform: string }>;
}

export interface InferResult {
  format: UploadedFormat;
  formatConfidence: number;
  formatReason: string;
  techniques: string[];
  tactics: string[];
  logsource: string;
  summary: string;
  mappings: InferredMappings;
}

function extractSigmaLight(body: string): { techniques: string[]; tactics: string[]; logsource: string } {
  let techniques: string[] = [];
  let tactics: string[] = [];
  let logsource = "";
  try {
    const parsed = yaml.load(body) as { tags?: string[]; logsource?: { category?: string; product?: string; service?: string } } | null;
    if (parsed) {
      const tags = parsed.tags || [];
      for (const t of tags) {
        const tm = t.match(/^attack\.(t\d{4}(?:\.\d{3})?)$/i);
        if (tm) techniques.push(tm[1].toUpperCase());
        const ta = t.match(/^attack\.([a-z_-]+)$/i);
        if (ta && !/^t\d/i.test(ta[1])) tactics.push(ta[1].replace(/_/g, "-"));
      }
      const ls: string[] = [];
      if (parsed.logsource?.category) ls.push(`category:${parsed.logsource.category}`);
      if (parsed.logsource?.product)  ls.push(`product:${parsed.logsource.product}`);
      if (parsed.logsource?.service)  ls.push(`service:${parsed.logsource.service}`);
      logsource = ls.join(", ");
    }
  } catch { /* fall through to regex */ }
  if (techniques.length === 0) techniques = extractTechniqueIds(body);
  return { techniques: [...new Set(techniques)], tactics: [...new Set(tactics)], logsource };
}

function extractElasticTomlLight(body: string): { techniques: string[]; tactics: string[]; logsource: string } {
  // Match [[rule.threat]] blocks → technique IDs
  const techniques = new Set<string>();
  for (const m of body.matchAll(/\bid\s*=\s*["'](T\d{4}(?:\.\d{3})?)["']/g)) techniques.add(m[1].toUpperCase());
  for (const t of extractTechniqueIds(body)) techniques.add(t);
  const tactics: string[] = [];
  for (const m of body.matchAll(/\bname\s*=\s*["']([a-z_-]+)["']/gi)) {
    // crude — Elastic tactic names like "Credential Access" sometimes lowercase
    if (/^[a-z_-]+$/i.test(m[1]) && !/T\d{4}/.test(m[1])) tactics.push(m[1].toLowerCase().replace(/_/g, "-"));
  }
  const indexes: string[] = [];
  for (const m of body.matchAll(/\bindex\s*=\s*\[([^\]]*)\]/g)) {
    for (const v of m[1].matchAll(/["']([^"']+)["']/g)) indexes.push(v[1]);
  }
  return {
    techniques: [...techniques],
    tactics: [...new Set(tactics)].slice(0, 6),
    logsource: indexes.length ? `index:${indexes.slice(0, 3).join(",")}` : "",
  };
}

function extractSplLight(body: string): { techniques: string[]; tactics: string[]; logsource: string } {
  const techniques = extractTechniqueIds(body);
  const pieces: string[] = [];
  for (const m of body.matchAll(/\bindex\s*=\s*["']?([A-Za-z0-9_\-*]+)["']?/g)) pieces.push(`index:${m[1]}`);
  for (const m of body.matchAll(/\bsourcetype\s*=\s*["']?([A-Za-z0-9_:\-\\.\*]+)["']?/g)) pieces.push(`sourcetype:${m[1]}`);
  return { techniques, tactics: [], logsource: pieces.slice(0, 4).join(", ") };
}

function extractKqlLight(body: string): { techniques: string[]; tactics: string[]; logsource: string } {
  const techniques = extractTechniqueIds(body);
  const tables = new Set<string>();
  for (const m of body.matchAll(/(?:^|\|\s*)([A-Z][A-Za-z0-9]+)(?=\s*\||\s+where|\s+project|\s+summarize)/g)) {
    tables.add(m[1]);
  }
  return { techniques, tactics: [], logsource: [...tables].slice(0, 4).map((t) => `table:${t}`).join(", ") };
}

function extractLight(format: UploadedFormat, body: string) {
  switch (format) {
    case "sigma":         return extractSigmaLight(body);
    case "elastic-toml":  return extractElasticTomlLight(body);
    case "spl":            return extractSplLight(body);
    case "kql":            return extractKqlLight(body);
    default:               return { techniques: extractTechniqueIds(body), tactics: [], logsource: "" };
  }
}

export async function inferUpload(filename: string, body: string): Promise<InferResult> {
  const sniff = sniffFormat(filename, body);
  const light = extractLight(sniff.format, body);
  const techniques = light.techniques;

  // Lookup candidates in parallel
  const [atomicRows, psRows, stratusRows] = techniques.length
    ? await Promise.all([
        prisma.atomicTest.findMany({
          where: { techniqueId: { in: techniques } },
          select: { techniqueId: true, testGuid: true, testName: true },
          take: 60,
        }),
        prisma.purpleSharpVariation.findMany({
          where: { techniqueId: { in: techniques } },
          select: { techniqueId: true, variation: true, variationLabel: true },
        }),
        prisma.stratusAttack.findMany({
          where: { OR: techniques.map((t) => ({ mitreTechniques: { contains: t } })) },
          select: { attackId: true, name: true, platform: true },
          take: 30,
        }),
      ])
    : [[], [], []];

  const summary = [
    `Uploaded ${sniff.format.toUpperCase()} rule "${filename}" (confidence ${(sniff.confidence * 100).toFixed(0)}%)`,
    light.logsource ? `Log sources: ${light.logsource}` : "",
    techniques.length ? `Techniques: ${techniques.join(", ")}` : "No technique tags found in file",
  ].filter(Boolean).join(". ");

  return {
    format: sniff.format,
    formatConfidence: sniff.confidence,
    formatReason: sniff.reason,
    techniques,
    tactics: light.tactics,
    logsource: light.logsource,
    summary,
    mappings: {
      atomic: atomicRows.map((r) => ({ techniqueId: r.techniqueId, testGuid: r.testGuid, testName: r.testName })),
      purplesharp: psRows.map((r) => ({ techniqueId: r.techniqueId, variation: r.variation, variationLabel: r.variationLabel })),
      stratus: stratusRows.map((r) => ({ attackId: r.attackId, name: r.name, platform: r.platform })),
    },
  };
}

export function buildRuleContextFromUpload(input: {
  filename: string;
  body: string;
  format: UploadedFormat;
  techniques: string[];
  tactics: string[];
  logsource: string;
}): RuleContext {
  return {
    sourceTable: "Upload",
    ruleId: "",
    upstreamRuleId: "",
    upstreamUrl: "",
    title: input.filename,
    description: "",
    ruleLanguage: input.format === "sigma" ? "sigma"
                : input.format === "spl" ? "spl"
                : input.format === "kql" ? "kql"
                : input.format === "elastic-toml" ? "kuery"
                : "pseudocode",
    detectionLogic: input.body.slice(0, 8000),
    mitreTechniques: input.techniques,
    mitreTactics: input.tactics,
    logSources: input.logsource ? [input.logsource] : [],
    platforms: [],
    products: [],
    severity: "",
    references: [],
    falsePositives: [],
    summary: "",
  };
}
