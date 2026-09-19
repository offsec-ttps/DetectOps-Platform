/**
 * Threat Intelligence Aggregator
 *
 * Orchestrates the full TI pipeline:
 * 1. Seed feed sources from config into DB
 * 2. Fetch RSS/Atom feeds
 * 3. Parse articles and extract IoCs
 * 4. Store articles and indicators
 * 5. Sync from Threadlinqs API for enriched threat reports
 */

import { prisma } from "@/lib/prisma";
import { RSS_FEEDS } from "./feed-config";
import { fetchRssFeed } from "./rss-fetcher";
import { extractIoCs, extractMitreTechniques, extractThreatActors } from "./ioc-extractor";
import { syncAllThreats as syncThreadlinqs } from "@/lib/threadlinqs";
import crypto from "crypto";

// ── Seed sources from config ──

export async function seedFeedSources(): Promise<number> {
  let created = 0;
  for (const feed of RSS_FEEDS) {
    const existing = await prisma.tiFeedSource.findUnique({ where: { feedUrl: feed.feedUrl } });
    if (!existing) {
      await prisma.tiFeedSource.create({
        data: {
          name: feed.name,
          type: feed.type,
          category: feed.category,
          blogUrl: feed.blogUrl,
          feedUrl: feed.feedUrl,
          active: true,
        },
      });
      created++;
    }
  }
  return created;
}

// ── Fetch and process a single RSS source ──

async function processRssSource(source: { id: string; name: string; feedUrl: string }): Promise<{
  articles: number; indicators: number; errors: string[];
}> {
  const errors: string[] = [];
  let articleCount = 0;
  let indicatorCount = 0;

  try {
    const feedArticles = await fetchRssFeed(source.feedUrl);

    for (const article of feedArticles.slice(0, 50)) { // Cap at 50 per source
      if (!article.url || !article.title) continue;

      // Check if already exists
      const existing = await prisma.tiArticle.findUnique({ where: { url: article.url } });
      if (existing) continue;

      const textContent = article.content || article.summary || "";
      const hash = crypto.createHash("sha256").update(textContent).digest("hex");

      // Extract IoCs from content
      const iocs = extractIoCs(textContent);
      const techniques = extractMitreTechniques(textContent);
      const actors = extractThreatActors(textContent);

      // Create article
      const dbArticle = await prisma.tiArticle.create({
        data: {
          sourceId: source.id,
          title: article.title.slice(0, 500),
          url: article.url,
          author: article.author.slice(0, 200),
          publishedAt: article.publishedAt ? tryParseDate(article.publishedAt) : null,
          rawContent: textContent.slice(0, 100000), // Cap at 100KB
          summary: article.summary.slice(0, 1000),
          tags: JSON.stringify([...article.tags, ...actors, ...techniques].slice(0, 50)),
          iocCount: iocs.length,
          processed: true,
          contentHash: hash,
        },
      });
      articleCount++;

      // Upsert indicators
      for (const ioc of iocs) {
        if (ioc.type === "mitre_technique") continue; // Stored in tags
        try {
          await prisma.tiIndicator.upsert({
            where: { type_value: { type: ioc.type, value: ioc.value.slice(0, 500) } },
            create: {
              articleId: dbArticle.id,
              type: ioc.type,
              value: ioc.value.slice(0, 500),
              context: ioc.context.slice(0, 500),
              mitreTechniques: JSON.stringify(techniques),
              sourceRef: article.url,
              tags: JSON.stringify(actors),
            },
            update: {
              lastSeen: new Date(),
              sightings: { increment: 1 },
              context: ioc.context.slice(0, 500),
            },
          });
          indicatorCount++;
        } catch {
          // Skip duplicates or constraint errors
        }
      }
    }

    // Update source stats
    await prisma.tiFeedSource.update({
      where: { id: source.id },
      data: {
        lastFetchedAt: new Date(),
        lastError: null,
        articleCount: { increment: articleCount },
        indicatorCount: { increment: indicatorCount },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${source.name}: ${msg}`);
    await prisma.tiFeedSource.update({
      where: { id: source.id },
      data: { lastError: msg },
    }).catch(() => {});
  }

  return { articles: articleCount, indicators: indicatorCount, errors };
}

// ── Full aggregator sync ──

export async function runAggregatorSync(): Promise<{
  sourcesProcessed: number;
  articlesFound: number;
  indicatorsFound: number;
  threadlinqsThreats: number;
  errorCount: number;
}> {
  const syncStartedAt = new Date();
  const syncRun = await prisma.tiAggregatorSync.create({
    data: { status: "running" },
  });

  try {
    // 1. Seed sources
    await seedFeedSources();

    // 2. Get all active RSS sources
    const sources = await prisma.tiFeedSource.findMany({
      where: { active: true, type: "rss" },
    });

    let totalArticles = 0;
    let totalIndicators = 0;
    let totalErrors = 0;

    // 3. Process feeds with concurrency limit (5 at a time)
    const CONCURRENCY = 5;
    for (let i = 0; i < sources.length; i += CONCURRENCY) {
      const batch = sources.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((s) => processRssSource(s))
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          totalArticles += result.value.articles;
          totalIndicators += result.value.indicators;
          totalErrors += result.value.errors.length;
        } else {
          totalErrors++;
        }
      }
    }

    // 4. Normalize articles with IoCs into unified threat format
    try {
      const { normalizeArticlesToThreats } = await import("./normalizer");
      await normalizeArticlesToThreats(500);
    } catch {
      // Normalization failure shouldn't break pipeline
    }

    // 5. Sync from Threadlinqs (if configured)
    let threadlinqsThreats = 0;
    try {
      const tlVendor = await prisma.tiVendor.findUnique({ where: { name: "Threadlinqs" } });
      if (tlVendor?.enabled && tlVendor?.apiKey) {
        const tlResult = await syncThreadlinqs(tlVendor.apiKey);
        threadlinqsThreats = tlResult.totalThreats;
        // Tag as threadlinqs source
        await prisma.threatIntelReport.updateMany({
          where: { sourceVendor: "" },
          data: { sourceVendor: "threadlinqs" },
        });
        await prisma.tiVendor.update({
          where: { name: "Threadlinqs" },
          data: { connected: true, lastSyncAt: new Date(), threatCount: tlResult.totalThreats },
        });
      } else {
        // Try with hardcoded key as fallback
        const tlResult = await syncThreadlinqs();
        threadlinqsThreats = tlResult.totalThreats;
        await prisma.threatIntelReport.updateMany({
          where: { sourceVendor: "" },
          data: { sourceVendor: "threadlinqs" },
        });
      }
    } catch {
      // Threadlinqs sync failure shouldn't break the whole pipeline
    }

    // 6. Update sync record
    await prisma.tiAggregatorSync.update({
      where: { id: syncRun.id },
      data: {
        status: "completed",
        sourcesProcessed: sources.length,
        articlesFound: totalArticles,
        indicatorsFound: totalIndicators,
        errorCount: totalErrors,
        completedAt: new Date(),
      },
    });

    // Phase 3 — enqueue Detection Pack jobs for ThreatIntelReport rows inserted
    // during this sync. Idempotent via the unique [sourceTable, sourceRefId] key.
    const { enqueueAfterSyncSafe } = await import("@/lib/detection-packs/enqueue");
    await enqueueAfterSyncSafe("ti", syncStartedAt);

    return {
      sourcesProcessed: sources.length,
      articlesFound: totalArticles,
      indicatorsFound: totalIndicators,
      threadlinqsThreats,
      errorCount: totalErrors,
    };
  } catch (err) {
    await prisma.tiAggregatorSync.update({
      where: { id: syncRun.id },
      data: {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

// ── Helper ──

function tryParseDate(dateStr: string): Date | null {
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
