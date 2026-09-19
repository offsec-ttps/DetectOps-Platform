/**
 * Article-to-Threat Normalizer
 *
 * Converts RSS articles (with extracted IoCs) into the same ThreatIntelReport
 * format used by Threadlinqs, so all threats appear in a unified view.
 */

import { prisma } from "@/lib/prisma";
import { extractIoCs, extractMitreTechniques, extractThreatActors } from "./ioc-extractor";
import crypto from "crypto";

interface NormalizationResult {
  processed: number;
  created: number;
  skipped: number;
}

/**
 * Normalize unprocessed articles into ThreatIntelReport format.
 * Only processes articles that have IoCs or significant content.
 */
export async function normalizeArticlesToThreats(limit = 500): Promise<NormalizationResult> {
  // Get articles that have IoCs but haven't been normalized yet
  const articles = await prisma.tiArticle.findMany({
    where: {
      iocCount: { gt: 0 },
      stixBundleId: "", // not yet normalized
    },
    include: {
      source: { select: { name: true, category: true } },
      indicators: true,
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });

  let created = 0;
  let skipped = 0;

  for (const article of articles) {
    const threatId = `RSS-${crypto.createHash("md5").update(article.url).digest("hex").slice(0, 12).toUpperCase()}`;

    // Skip if already exists
    const existing = await prisma.threatIntelReport.findUnique({ where: { threatId } });
    if (existing) {
      await prisma.tiArticle.update({ where: { id: article.id }, data: { stixBundleId: "normalized" } });
      skipped++;
      continue;
    }

    const text = article.rawContent || article.summary || "";
    const tags = JSON.parse(article.tags) as string[];
    const techniques = extractMitreTechniques(text);
    const actors = extractThreatActors(text);

    // Build IoCs structure matching Threadlinqs format
    const iocs: Record<string, any[]> = { network: [], file: [], behavioral: [] };
    for (const ind of article.indicators) {
      const entry = { type: ind.type, value: ind.value, context: ind.context };
      if (["ipv4", "ipv6", "domain", "url", "email"].includes(ind.type)) {
        iocs.network.push(entry);
      } else if (["sha256", "sha1", "md5", "filename"].includes(ind.type)) {
        iocs.file.push(entry);
      } else {
        iocs.behavioral.push(entry);
      }
    }

    // Build MITRE techniques structure
    const mitreMapped = techniques.map((t) => ({
      technique_id: t,
      technique: t,
      tactic: "Unknown",
      tactic_id: "",
    }));

    // Determine severity from content signals
    const severity = determineSeverity(text, article.iocCount, techniques.length, actors);
    const category = determineCategory(text, tags, actors);

    await prisma.threatIntelReport.create({
      data: {
        threatId,
        title: article.title,
        summary: article.summary || text.slice(0, 500),
        description: text.slice(0, 5000),
        severityLevel: severity,
        cvssScore: severity === "CRITICAL" ? 9.0 : severity === "HIGH" ? 7.5 : severity === "MEDIUM" ? 5.0 : 3.0,
        category,
        status: "ACTIVE",
        exploitability: article.iocCount > 10 ? "ACTIVE" : "UNKNOWN",
        threatActor: actors[0] || "",
        threatActorAliases: JSON.stringify(actors.slice(1)),
        nationState: "",
        motivation: "",
        attributionConfidence: actors.length > 0 ? "MEDIUM" : "LOW",
        mitreTechniques: JSON.stringify(mitreMapped),
        iocs: JSON.stringify(iocs),
        detections: JSON.stringify([]),
        detectionCount: 0,
        timeline: JSON.stringify([
          { date: article.publishedAt ? article.publishedAt.toISOString().split("T")[0] : new Date().toISOString().split("T")[0], event: "Article published", key: "published" },
        ]),
        references: JSON.stringify([
          { title: article.title, url: article.url, type: "blog", date: article.publishedAt?.toISOString().split("T")[0] || "" },
        ]),
        remediation: JSON.stringify({}),
        targetSectors: JSON.stringify([]),
        targetRegions: JSON.stringify([]),
        tags: JSON.stringify(tags.slice(0, 30)),
        affected: JSON.stringify([]),
        contentHash: article.contentHash,
        sourceVendor: "rss",
        sourceUrl: article.url,
        sourceCreated: article.publishedAt,
        sourceUpdated: article.publishedAt,
      },
    });

    await prisma.tiArticle.update({ where: { id: article.id }, data: { stixBundleId: "normalized" } });
    created++;
  }

  return { processed: articles.length, created, skipped };
}

function determineSeverity(text: string, iocCount: number, techniqueCount: number, actors: string[]): string {
  const lower = text.toLowerCase();
  if (lower.includes("critical") || lower.includes("zero-day") || lower.includes("0-day") || lower.includes("active exploit") || iocCount > 20) return "CRITICAL";
  if (actors.length > 0 || lower.includes("apt") || lower.includes("ransomware") || lower.includes("supply chain") || techniqueCount > 3) return "HIGH";
  if (iocCount > 5 || techniqueCount > 1 || lower.includes("vulnerability") || lower.includes("malware")) return "MEDIUM";
  return "LOW";
}

function determineCategory(text: string, tags: string[], actors: string[]): string {
  const lower = text.toLowerCase();
  const allText = lower + " " + tags.join(" ").toLowerCase();
  if (actors.length > 0 || allText.includes("apt") || allText.includes("nation-state") || allText.includes("espionage")) return "APT";
  if (allText.includes("ransomware") || allText.includes("ransom")) return "RANSOMWARE";
  if (allText.includes("supply chain") || allText.includes("npm") || allText.includes("pypi") || allText.includes("dependency")) return "SUPPLY_CHAIN";
  if (allText.includes("phishing") || allText.includes("social engineering")) return "PHISHING";
  if (allText.includes("zero-day") || allText.includes("0-day") || allText.includes("zero day")) return "ZERO_DAY";
  if (allText.includes("cve-") || allText.includes("vulnerability") || allText.includes("patch")) return "VULNERABILITY";
  if (allText.includes("malware") || allText.includes("trojan") || allText.includes("backdoor") || allText.includes("rat")) return "MALWARE";
  return "THREAT_INTEL";
}
