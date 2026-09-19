/**
 * Generate SPL (Splunk) and KQL (Microsoft Sentinel / Defender XDR) variants
 * of a canonical Sigma rule body.
 *
 * Strategy:
 *   1. Community import — first look for an exact community rule whose
 *      MITRE techniques overlap with the use case. If a SigmaHQ rule, a
 *      Splunk ESCU detection (SPL), or a Sentinel/Defender KQL row matches,
 *      we adopt its body as-is. This produces battle-tested logic instead of
 *      a raw machine conversion when available.
 *   2. Sigma-CLI conversion — when no community match exists for a format,
 *      we run the local `sigma convert` binary against the recommended
 *      Sigma body. Splunk uses backend "splunk", KQL uses backend "kusto".
 *   3. Notes — every choice is recorded so the UI can show "imported from
 *      community rule X" vs. "converted via sigma-cli".
 *
 * Returns:
 *   {
 *     spl: { body, source: "community"|"converted"|"unavailable", note },
 *     kql: { body, source: …, note },
 *   }
 */

import { prisma } from "@/lib/prisma";
import { convertSigmaRule } from "@/lib/community-sources/sigma-cli";

export type LogicSource = "community" | "converted" | "unavailable";

export interface FormatResult {
  body: string;
  source: LogicSource;
  note: string;
  communityRefId?: string;             // when source="community", the row id we adopted
  communityRefSource?: string;         // "sigma" | "splunk" | "elastic"
}

export interface MultiFormatResult {
  spl: FormatResult;
  kql: FormatResult;
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

function overlap(a: string[], b: string[]): number {
  const sa = new Set(a.map((t) => t.toUpperCase()));
  let n = 0;
  for (const t of b) if (sa.has(t.toUpperCase())) n++;
  return n;
}

async function findCommunitySplunk(techniques: string[]): Promise<{ body: string; refId: string } | null> {
  if (techniques.length === 0) return null;
  const rows = await prisma.splunkDetection.findMany({
    where: { OR: techniques.map((t) => ({ mitreTechniques: { contains: `"${t}"` } })) } as any,
    select: { id: true, search: true, mitreTechniques: true, status: true },
    take: 32,
  });
  if (rows.length === 0) return null;
  // Prefer the row with the highest technique-overlap; ties broken by
  // production status > anomaly > hunting > deprecated.
  const ranked = rows
    .map((r) => ({
      r,
      score: overlap(techniques, safeJson<string[]>(r.mitreTechniques, [])),
      statusRank: r.status === "production" ? 3 : r.status === "experimental" ? 2 : 1,
    }))
    .filter((x) => x.score > 0 && x.r.search.trim().length > 0)
    .sort((a, b) => b.score - a.score || b.statusRank - a.statusRank);
  if (ranked.length === 0) return null;
  return { body: ranked[0].r.search, refId: ranked[0].r.id };
}

async function findCommunityKql(techniques: string[]): Promise<{ body: string; refId: string } | null> {
  if (techniques.length === 0) return null;
  // KQL-language community content lives in CommunityRule (Sentinel, Defender
  // XDR, Google SecOps, etc.). Filter by ruleLanguage so we only adopt KQL
  // bodies — we don't want to grab a Python rule and call it KQL.
  const rows = await prisma.communityRule.findMany({
    where: {
      AND: [
        { ruleLanguage: "kql" },
        { OR: techniques.map((t) => ({ mitreTechniques: { contains: `"${t}"` } })) },
      ],
    } as any,
    select: { id: true, ruleLanguage: true, detectionLogicRaw: true, mitreTechniques: true, status: true },
    take: 32,
  });
  if (rows.length === 0) return null;
  const ranked = rows
    .map((r) => ({
      r,
      score: overlap(techniques, safeJson<string[]>(r.mitreTechniques, [])),
      statusRank: r.status === "production" ? 3 : r.status === "experimental" ? 2 : 1,
    }))
    .filter((x) => x.score > 0 && (x.r.detectionLogicRaw || "").trim().length > 0)
    .sort((a, b) => b.score - a.score || b.statusRank - a.statusRank);
  if (ranked.length === 0) return null;
  return { body: ranked[0].r.detectionLogicRaw, refId: ranked[0].r.id };
}

async function convertSigmaSafe(sigma: string, backend: "splunk" | "kusto"): Promise<{ body: string; note: string } | null> {
  try {
    const r = await convertSigmaRule(sigma, backend);
    if (r.success && r.query) {
      return {
        body: r.query,
        note: r.stderr ? `converted via sigma-cli (with warnings: ${r.stderr.slice(0, 200)})` : "converted via sigma-cli",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the SPL + KQL variants for a use case.
 *
 * `sigmaBody` should be the canonical Sigma YAML (i.e. the recommended body).
 * `techniques` drives the community-rule lookup; pass the use case's mapped
 * MITRE techniques. When neither community nor sigma-cli can produce a body,
 * the format is marked `source: "unavailable"`.
 */
export async function generateMultiFormat(
  sigmaBody: string,
  techniques: string[],
): Promise<MultiFormatResult> {
  const result: MultiFormatResult = {
    spl: { body: "", source: "unavailable", note: "" },
    kql: { body: "", source: "unavailable", note: "" },
  };

  // ── SPL ──────────────────────────────────────────────────────────────────
  const splCommunity = await findCommunitySplunk(techniques);
  if (splCommunity) {
    result.spl = {
      body: splCommunity.body,
      source: "community",
      note: `Imported from Splunk ESCU detection ${splCommunity.refId.slice(0, 8)} (matches by ATT&CK technique)`,
      communityRefId: splCommunity.refId,
      communityRefSource: "splunk",
    };
  } else if (sigmaBody) {
    const conv = await convertSigmaSafe(sigmaBody, "splunk");
    if (conv) {
      result.spl = { body: conv.body, source: "converted", note: conv.note };
    } else {
      result.spl = {
        body: "",
        source: "unavailable",
        note: "No Splunk ESCU community match, and sigma-cli could not convert this rule to SPL. Edit the body manually or install pysigma-backend-splunk.",
      };
    }
  } else {
    result.spl.note = "No canonical Sigma body to convert from. Generate Recommended first.";
  }

  // ── KQL ──────────────────────────────────────────────────────────────────
  const kqlCommunity = await findCommunityKql(techniques);
  if (kqlCommunity) {
    result.kql = {
      body: kqlCommunity.body,
      source: "community",
      note: `Imported from Sentinel/Defender community rule ${kqlCommunity.refId.slice(0, 8)} (matches by ATT&CK technique)`,
      communityRefId: kqlCommunity.refId,
      communityRefSource: "unified",
    };
  } else if (sigmaBody) {
    const conv = await convertSigmaSafe(sigmaBody, "kusto");
    if (conv) {
      result.kql = { body: conv.body, source: "converted", note: conv.note };
    } else {
      result.kql = {
        body: "",
        source: "unavailable",
        note: "No Sentinel/Defender community match, and sigma-cli could not convert this rule to KQL. Edit the body manually or install pysigma-backend-kusto.",
      };
    }
  } else {
    result.kql.note = "No canonical Sigma body to convert from. Generate Recommended first.";
  }

  return result;
}
