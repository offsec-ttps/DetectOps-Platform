/**
 * Given a list of MITRE technique IDs, find the matching simulations across
 * AtomicTest, PurpleSharpVariation, and StratusAttack catalogues. Returns a
 * deduped, capped list ready to insert as DetectionSimulation rows.
 *
 * Mirrors the candidate-finder in src/lib/use-cases/upload/infer-mapping.ts
 * but emits the DetectionSimulation shape (framework + refId + rationale).
 *
 * Relevance ranking:
 *   When a `relevanceHint` string is supplied (e.g. the use case's name +
 *   description + detection-body excerpt), candidate tests are scored by
 *   token overlap with that hint. Without a hint, the legacy behaviour of
 *   "first test per technique by executorName/testNumber order" is kept so
 *   existing Detection Pack callers don't regress.
 *
 *   The Enterprise Use Case pipeline ALWAYS passes a hint, so for example a
 *   use case about "certutil" gets the certutil-specific ART test for T1140
 *   instead of the alphabetically-first base64-Python test.
 */

import { prisma } from "@/lib/prisma";

export interface SimDraft {
  framework: "atomic" | "purplesharp" | "stratus";
  refId: string;
  techniqueId: string;
  displayName: string;
  description: string;
  rationale: string;
  /** 0..1 — higher means a stronger match against the relevance hint. Absent when no hint was supplied. */
  relevanceScore?: number;
}

interface InferOptions {
  techniques: string[];
  /** Cap per framework so a 12-technique pack doesn't produce 200 sim rows. */
  capPerFramework?: number;
  /**
   * Free-form text from the use case (name + description + extracted body
   * keywords) that biases ranking. When omitted, the legacy "one row per
   * technique" path runs.
   */
  relevanceHint?: string;
  /**
   * When true and a hint is supplied, allow multiple tests per technique so
   * a single technique with N relevant variants surfaces all of them.
   * Defaults to true when a hint is set.
   */
  multiPerTechnique?: boolean;
}

// ─── Hint tokenisation + relevance scoring ──────────────────────────────────

const STOPWORDS = new Set([
  "the","and","for","with","via","that","this","when","than","then",
  "are","was","were","will","been","being","does","does'nt","doesn",
  "use","uses","used","using","run","runs","ran","running",
  "may","can","could","would","should","might","also",
  "from","into","onto","over","under","through","across",
  "process","command","commandline","cmd","exe","dll","execution",
  "detection","detect","detects","detected","detecting",
  "rule","rules","query","script","tool","tools",
  "attack","attacker","adversary","adversaries","malicious","suspicious",
  "system","windows","linux","macos","cloud",
  "user","users","group","groups",
  "true","false","null","none",
  "test","tests","testing","scenario","step","steps","payload","payloads",
]);

function tokenise(s: string): string[] {
  return (s || "")
    .toLowerCase()
    // Keep dotted .exe and .dll tokens together but split on most punctuation
    .replace(/[^a-z0-9._\-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function scoreCandidate(hintTokens: Set<string>, text: { name: string; command: string; description: string }): number {
  if (hintTokens.size === 0) return 0;
  let score = 0;
  const nameToks = new Set(tokenise(text.name));
  const cmdToks  = new Set(tokenise(text.command));
  const descToks = new Set(tokenise(text.description));
  for (const h of hintTokens) {
    if (nameToks.has(h)) score += 3;       // strongest signal — test name aligns
    else if (cmdToks.has(h)) score += 2;   // medium — command literal match
    else if (descToks.has(h)) score += 1;  // weak — description mention
  }
  return score;
}

// ─── Main inference ─────────────────────────────────────────────────────────

export async function inferSimulations({
  techniques, capPerFramework = 5, relevanceHint = "", multiPerTechnique,
}: InferOptions): Promise<SimDraft[]> {
  if (!techniques?.length) return [];
  const tids = [...new Set(techniques.filter((t) => /^T\d{4}(\.\d{3})?$/.test(t)))];
  if (!tids.length) return [];

  const hintTokens = new Set(tokenise(relevanceHint));
  const useRanking = hintTokens.size > 0;
  const allowMulti = useRanking && multiPerTechnique !== false;

  const out: SimDraft[] = [];

  // ── Atomic Red Team ──────────────────────────────────────────────────────
  // Pull a generous candidate pool when ranking; the cap is applied AFTER
  // scoring. Without a hint, fall back to the legacy "first test per
  // technique" behaviour so Detection Pack callers don't regress.
  const atomicPoolLimit = useRanking ? Math.max(capPerFramework * 10, 60) : capPerFramework * 3;
  const atomicRows = await prisma.atomicTest.findMany({
    where: { techniqueId: { in: tids } },
    orderBy: [{ executorName: "asc" }, { testNumber: "asc" }],
    take: atomicPoolLimit,
    select: { testGuid: true, techniqueId: true, testName: true, testDescription: true, executorName: true, command: true },
  }).catch(() => []);

  if (useRanking) {
    const scored = atomicRows
      .map((a) => ({
        a,
        score: scoreCandidate(hintTokens, { name: a.testName, command: a.command || "", description: a.testDescription || "" }),
      }))
      // Drop zero-score tests when *any* test for that technique scored — but
      // keep zero-score tests for techniques where NOTHING matched, so the
      // technique still gets covered by at least one test.
      .sort((x, y) => y.score - x.score);

    const seenByTech = new Map<string, number>();
    for (const { a, score } of scored) {
      // When allowMulti, accept up to 3 tests per technique. Otherwise 1.
      const cap = allowMulti ? 3 : 1;
      if ((seenByTech.get(a.techniqueId) || 0) >= cap) continue;
      // Skip a zero-score test if we already accepted one for this technique.
      if (score === 0 && (seenByTech.get(a.techniqueId) || 0) > 0) continue;
      out.push({
        framework: "atomic",
        refId: a.testGuid,
        techniqueId: a.techniqueId,
        displayName: a.testName,
        description: (a.testDescription || "").slice(0, 400),
        rationale: score > 0
          ? `Matches use-case context (${score} keyword hit${score > 1 ? "s" : ""}); ART test "${a.testName}" (${a.executorName}).`
          : `Validates rules covering ${a.techniqueId} via the ART test "${a.testName}" (${a.executorName}).`,
        relevanceScore: score,
      });
      seenByTech.set(a.techniqueId, (seenByTech.get(a.techniqueId) || 0) + 1);
      if (out.filter((x) => x.framework === "atomic").length >= capPerFramework) break;
    }
  } else {
    const atomicSeen = new Set<string>();
    for (const a of atomicRows) {
      if (atomicSeen.has(a.techniqueId)) continue;
      atomicSeen.add(a.techniqueId);
      out.push({
        framework: "atomic",
        refId: a.testGuid,
        techniqueId: a.techniqueId,
        displayName: a.testName,
        description: (a.testDescription || "").slice(0, 400),
        rationale: `Validates rules covering ${a.techniqueId} via the ART test "${a.testName}" (${a.executorName}).`,
      });
      if (out.filter((x) => x.framework === "atomic").length >= capPerFramework) break;
    }
  }

  // ── PurpleSharp ──────────────────────────────────────────────────────────
  const psPoolLimit = useRanking ? Math.max(capPerFramework * 6, 40) : capPerFramework * 3;
  const psRows = await prisma.purpleSharpVariation.findMany({
    where: { techniqueId: { in: tids } },
    orderBy: [{ techniqueId: "asc" }, { variation: "asc" }],
    take: psPoolLimit,
    select: { id: true, techniqueId: true, techniqueName: true, variation: true, variationLabel: true, description: true },
  }).catch(() => []);

  if (useRanking) {
    const scored = psRows
      .map((p) => ({
        p,
        score: scoreCandidate(hintTokens, {
          name: `${p.techniqueName} ${p.variationLabel || ""}`,
          command: "",
          description: p.description || "",
        }),
      }))
      .sort((x, y) => y.score - x.score);
    const seenByTech = new Map<string, number>();
    for (const { p, score } of scored) {
      const cap = allowMulti ? 2 : 1;
      if ((seenByTech.get(p.techniqueId) || 0) >= cap) continue;
      if (score === 0 && (seenByTech.get(p.techniqueId) || 0) > 0) continue;
      out.push({
        framework: "purplesharp",
        refId: p.id,
        techniqueId: p.techniqueId,
        displayName: `${p.techniqueName} — variation ${p.variation}${p.variationLabel ? ` (${p.variationLabel})` : ""}`,
        description: (p.description || "").slice(0, 400),
        rationale: score > 0
          ? `Matches use-case context (${score} keyword hit${score > 1 ? "s" : ""}); PurpleSharp variation ${p.variation}.`
          : `Reproducible binary execution of ${p.techniqueId} via PurpleSharp variation ${p.variation}.`,
        relevanceScore: score,
      });
      seenByTech.set(p.techniqueId, (seenByTech.get(p.techniqueId) || 0) + 1);
      if (out.filter((x) => x.framework === "purplesharp").length >= capPerFramework) break;
    }
  } else {
    const psSeen = new Set<string>();
    for (const p of psRows) {
      if (psSeen.has(p.techniqueId)) continue;
      psSeen.add(p.techniqueId);
      out.push({
        framework: "purplesharp",
        refId: p.id,
        techniqueId: p.techniqueId,
        displayName: `${p.techniqueName} — variation ${p.variation}${p.variationLabel ? ` (${p.variationLabel})` : ""}`,
        description: (p.description || "").slice(0, 400),
        rationale: `Reproducible binary execution of ${p.techniqueId} via PurpleSharp variation ${p.variation}.`,
      });
      if (out.filter((x) => x.framework === "purplesharp").length >= capPerFramework) break;
    }
  }

  // ── Stratus ──────────────────────────────────────────────────────────────
  const stratusRows = await prisma.stratusAttack.findMany({
    take: useRanking ? capPerFramework * 10 : capPerFramework * 6,
    select: { id: true, attackId: true, name: true, description: true, mitreTechniques: true, platform: true },
  }).catch(() => []);

  const stratusCandidates: Array<{ s: typeof stratusRows[number]; tech: string; score: number }> = [];
  for (const s of stratusRows) {
    let attackTids: string[] = [];
    try { attackTids = JSON.parse(s.mitreTechniques) || []; } catch { /* skip */ }
    const hit = tids.find((t) => attackTids.includes(t));
    if (!hit) continue;
    const score = useRanking ? scoreCandidate(hintTokens, { name: s.name, command: "", description: s.description || "" }) : 0;
    stratusCandidates.push({ s, tech: hit, score });
  }
  stratusCandidates.sort((x, y) => y.score - x.score);
  for (const { s, tech, score } of stratusCandidates) {
    out.push({
      framework: "stratus",
      refId: s.attackId,
      techniqueId: tech,
      displayName: s.name,
      description: (s.description || "").slice(0, 400),
      rationale: useRanking && score > 0
        ? `Matches use-case context (${score} keyword hit${score > 1 ? "s" : ""}); Stratus on ${s.platform}.`
        : `Cloud-native execution of ${tech} on ${s.platform} via Stratus Red Team.`,
      relevanceScore: useRanking ? score : undefined,
    });
    if (out.filter((x) => x.framework === "stratus").length >= capPerFramework) break;
  }

  return out;
}
