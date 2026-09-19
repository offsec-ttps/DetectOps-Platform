/**
 * MITRE CAR (Cyber Analytics Repository) Adapter
 *
 * Source: https://github.com/mitre-attack/car
 * Format: One YAML file per analytic in `analytics/CAR-YYYY-MM-NNN.yaml`
 *
 * Each analytic carries:
 *   - id (CAR-YYYY-MM-NNN), title, description, submission_date
 *   - platforms[], analytic_types[], subtypes[], contributors[]
 *   - coverage[] — ATT&CK technique mapping with subtechniques + tactics
 *   - implementations[] — pseudocode + tool-specific code (Splunk, EQL, DNIF, LogPoint, etc)
 *   - d3fend_mappings[]
 *
 * MITRE CAR analytics are analytic *references* — they include pseudocode and
 * sometimes Splunk/EQL examples but they are not Sigma-native and not directly
 * convertible. We surface them as a discovery source for detection logic ideas.
 *
 * Storage: writes into the unified `community_rules` table.
 */

import * as yaml from "js-yaml";
import { createHash } from "crypto";
import type { ICommunitySourceAdapter, NormalizedRule, RuleLanguage, SyncResult } from "../types";

const CAR_REPO_OWNER = "mitre-attack";
const CAR_REPO_NAME = "car";
const CAR_BRANCH = "master";
const CAR_RAW_BASE = `https://raw.githubusercontent.com/${CAR_REPO_OWNER}/${CAR_REPO_NAME}/${CAR_BRANCH}`;
const CAR_TREE_API = `https://api.github.com/repos/${CAR_REPO_OWNER}/${CAR_REPO_NAME}/git/trees/${CAR_BRANCH}?recursive=1`;
const SOURCE_NAME = "MITRE CAR";
const SOURCE_TYPE = "mitre-car";

interface CarYamlSchema {
  id?: string;
  title?: string;
  description?: string;
  submission_date?: string;
  information_domain?: string;
  platforms?: string[];
  subtypes?: string[];
  analytic_types?: string[];
  contributors?: string[];
  coverage?: Array<{
    technique?: string;
    tactics?: string[];
    subtechniques?: string[];
    coverage?: string;
  }>;
  implementations?: Array<{
    name?: string;
    description?: string;
    code?: string;
    type?: string;
    data_model?: string;
  }>;
  d3fend_mappings?: Array<{ iri?: string; id?: string; label?: string }>;
}

// ── Helpers ──

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

function hashContent(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

interface TreeNode { path: string; type: string; sha: string }

async function fetchAnalyticPaths(): Promise<string[]> {
  const res = await fetch(CAR_TREE_API, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`MITRE CAR tree fetch failed: ${res.status} ${res.statusText}`);
  const data: { tree?: TreeNode[]; truncated?: boolean } = await res.json();
  if (!data.tree) throw new Error("Unexpected tree response");
  return data.tree
    .filter((n) => n.type === "blob" && n.path.startsWith("analytics/CAR-") && n.path.endsWith(".yaml"))
    .map((n) => n.path);
}

async function fetchAnalyticContent(filePath: string): Promise<string> {
  const url = `${CAR_RAW_BASE}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${filePath} → ${res.status}`);
  return await res.text();
}

/** Parse a single CAR analytic YAML into a NormalizedRule shape. */
function parseCarYaml(filePath: string, raw: string): NormalizedRule | null {
  let parsed: CarYamlSchema;
  try {
    parsed = yaml.load(raw) as CarYamlSchema;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !parsed.id) return null;

  // Flatten ATT&CK coverage → list of technique IDs (incl. subtechniques) + tactics
  const techniques = new Set<string>();
  const tactics = new Set<string>();
  for (const c of parsed.coverage ?? []) {
    if (c.technique) techniques.add(c.technique);
    for (const sub of c.subtechniques ?? []) techniques.add(sub);
    for (const t of c.tactics ?? []) tactics.add(t);
  }

  // Pick the "primary" implementation language for routing in the UI.
  // Preference order: Splunk > EQL > pseudocode > first available.
  const impls = parsed.implementations ?? [];
  const splunkImpl = impls.find((i) => /^splunk$/i.test(i.type ?? ""));
  const eqlImpl = impls.find((i) => /^eql$/i.test(i.type ?? ""));
  const pseudoImpl = impls.find((i) => /pseudocode/i.test(i.type ?? ""));
  const primary = splunkImpl ?? eqlImpl ?? pseudoImpl ?? impls[0];

  let detectionLogicRaw = "";
  let ruleLanguage: RuleLanguage = "pseudocode";
  if (primary?.code) {
    detectionLogicRaw = primary.code.trim();
    const t = (primary.type ?? "").toLowerCase();
    if (t === "splunk") ruleLanguage = "spl";
    else if (t === "eql") ruleLanguage = "eql";
    else if (t.includes("logpoint") || t.includes("dnif")) ruleLanguage = "pseudocode";
    else ruleLanguage = "pseudocode";
  } else {
    detectionLogicRaw = parsed.description ?? "";
  }

  const submission = parsed.submission_date
    ? new Date(parsed.submission_date.replace(/\//g, "-"))
    : null;

  return {
    upstreamRuleId: parsed.id,
    title: parsed.title ?? parsed.id,
    description: (parsed.description ?? "").trim(),
    author: (parsed.contributors ?? []).join(", "),
    upstreamCreatedAt: submission && !isNaN(submission.getTime()) ? submission : null,
    upstreamModifiedAt: null,
    mitreTechniques: [...techniques],
    mitreTactics: [...tactics],
    platforms: (parsed.platforms ?? []).map((p) => p.toLowerCase()),
    products: impls.map((i) => i.type ?? "").filter(Boolean),
    logSources: parsed.subtypes ?? [],
    tags: parsed.analytic_types ?? [],
    ruleLanguage,
    ruleType: "analytic",
    detectionLogicRaw,
    conversionSupported: false, // CAR is not Sigma-native
    severity: "", // CAR doesn't define severity
    status: "production",
    references: [`https://car.mitre.org/analytics/${parsed.id}/`],
    falsePositives: [],
    sourceFilePath: filePath,
    sourceUrl: `${CAR_RAW_BASE}/${filePath}`,
    rawPayload: parsed as unknown as Record<string, unknown>,
  };
}

// ── Adapter ──

export const mitreCarAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "mitre-car",
    name: SOURCE_NAME,
    type: SOURCE_TYPE,
    category: "analytic-reference",
    url: `https://github.com/${CAR_REPO_OWNER}/${CAR_REPO_NAME}`,
    description:
      "MITRE Cyber Analytics Repository — analytic rationale, ATT&CK mapping, and tool-specific implementations (Splunk, EQL, pseudocode).",
    sigmaConvertible: false,
    nativeUI: true, // we'll create a /community/mitre-car page
    legacy: false,
  }),

  async sync(): Promise<SyncResult> {
    const { prisma } = await import("@/lib/prisma");
    const errors: { file?: string; message: string }[] = [];
    let newCount = 0;
    let modifiedCount = 0;

    // Ensure source row exists
    const source = await prisma.communitySource.upsert({
      where: { name: SOURCE_NAME },
      update: {},
      create: {
        name: SOURCE_NAME,
        type: SOURCE_TYPE,
        description:
          "MITRE Cyber Analytics Repository (CAR) — analytics with ATT&CK mappings and tool-specific implementations.",
        url: `https://github.com/${CAR_REPO_OWNER}/${CAR_REPO_NAME}`,
      },
    });

    let paths: string[];
    try {
      paths = await fetchAnalyticPaths();
    } catch (e: any) {
      return {
        newCount: 0, modifiedCount: 0, deletedCount: 0, totalAfterSync: 0,
        errors: [{ message: `Failed to list MITRE CAR analytics: ${e.message}` }],
      };
    }

    // Track upstream paths so we can flag deleted analytics later
    const seenPaths = new Set<string>();

    // Process in batches of 25 — CAR has ~250 files so this is fast
    for (let i = 0; i < paths.length; i += 25) {
      const batch = paths.slice(i, i + 25);
      const results = await Promise.allSettled(
        batch.map(async (p) => {
          const raw = await fetchAnalyticContent(p);
          return { p, raw };
        }),
      );

      for (const r of results) {
        if (r.status === "rejected") {
          errors.push({ message: String(r.reason) });
          continue;
        }
        const { p, raw } = r.value;
        seenPaths.add(p);
        const norm = parseCarYaml(p, raw);
        if (!norm) {
          errors.push({ file: p, message: "yaml parse failed" });
          continue;
        }
        const hash = hashContent(raw);

        const existing = await prisma.communityRule.findUnique({
          where: { sourceId_sourceFilePath: { sourceId: source.id, sourceFilePath: p } },
        });

        const dataPayload = {
          sourceId: source.id,
          upstreamRuleId: norm.upstreamRuleId,
          title: norm.title,
          description: norm.description,
          author: norm.author,
          upstreamCreatedAt: norm.upstreamCreatedAt,
          upstreamModifiedAt: norm.upstreamModifiedAt,
          mitreTechniques: JSON.stringify(norm.mitreTechniques),
          mitreTactics: JSON.stringify(norm.mitreTactics),
          platforms: JSON.stringify(norm.platforms),
          products: JSON.stringify(norm.products),
          logSources: JSON.stringify(norm.logSources),
          tags: JSON.stringify(norm.tags),
          ruleLanguage: norm.ruleLanguage,
          ruleType: norm.ruleType,
          detectionLogicRaw: norm.detectionLogicRaw,
          conversionSupported: norm.conversionSupported,
          severity: norm.severity,
          status: norm.status,
          references: JSON.stringify(norm.references),
          falsePositives: JSON.stringify(norm.falsePositives),
          sourceFilePath: norm.sourceFilePath,
          sourceUrl: norm.sourceUrl,
          rawPayload: JSON.stringify(norm.rawPayload),
          contentHash: hash,
        };

        if (!existing) {
          await prisma.communityRule.create({ data: { ...dataPayload, changeStatus: "new" } });
          newCount++;
        } else if (existing.contentHash !== hash) {
          await prisma.communityRule.update({
            where: { id: existing.id },
            data: { ...dataPayload, changeStatus: "modified" },
          });
          modifiedCount++;
        }
      }
    }

    // Mark removed-upstream rules as deleted (don't actually delete — keep history)
    let deletedCount = 0;
    if (seenPaths.size > 0) {
      const allLocal = await prisma.communityRule.findMany({
        where: { sourceId: source.id },
        select: { id: true, sourceFilePath: true },
      });
      for (const r of allLocal) {
        if (!seenPaths.has(r.sourceFilePath)) {
          await prisma.communityRule.update({
            where: { id: r.id },
            data: { changeStatus: "deleted" },
          });
          deletedCount++;
        }
      }
    }

    const totalAfterSync = await prisma.communityRule.count({
      where: { sourceId: source.id, changeStatus: { not: "deleted" } },
    });

    await prisma.communitySource.update({
      where: { id: source.id },
      data: { lastSyncAt: new Date(), totalRules: totalAfterSync },
    });

    return { newCount, modifiedCount, deletedCount, totalAfterSync, errors };
  },
};
