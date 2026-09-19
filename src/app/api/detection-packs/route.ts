/**
 * GET /api/detection-packs — paginated list with filters
 *   ?category=&severity=&status=&q=&page=&pageSize=
 *   ?platformBucket=windows|linux|macos|cloud|saas|container|network|hypervisor|browser|other
 *
 * Platform buckets aggregate the raw `DetectionPack.platforms` JSON values
 * into the user-facing groups shown as filter chips on the list page.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

// Raw platform value → display bucket. Anything not in the map is "other".
const PLATFORM_BUCKETS: Record<string, string> = {
  "windows": "windows",
  "linux": "linux",
  "macos": "macos",
  "containers": "container",
  "network": "network",
  // Cloud / IaaS
  "aws": "cloud", "azure": "cloud", "gcp": "cloud",
  "iaas": "cloud", "iaas:aws": "cloud", "iaas:azure": "cloud", "iaas:gcp": "cloud",
  // SaaS / Identity
  "saas": "saas",
  "office-365": "saas", "azure-ad": "saas", "google-workspace": "saas", "okta": "saas",
  "entra-id": "saas",
  // (Hypervisor / Browser surfaced for completeness; data may show 0)
  "hypervisor": "hypervisor", "esxi": "hypervisor", "vmware": "hypervisor",
  "browser": "browser", "chrome": "browser", "firefox": "browser",
};

// SQL-safe quoted match strings per bucket (used to filter by platform).
// `platforms` is a JSON-encoded array like ["windows","linux"] so a substring
// match on `"<value>"` (with quotes) is sufficient to find packs in a bucket.
const BUCKET_TO_RAW: Record<string, string[]> = {};
for (const [raw, bucket] of Object.entries(PLATFORM_BUCKETS)) {
  (BUCKET_TO_RAW[bucket] ??= []).push(raw);
}

const KNOWN_BUCKETS = [
  "windows", "linux", "macos", "cloud", "saas",
  "container", "network", "hypervisor", "browser", "other",
] as const;

function bucketize(raw: string[]): Set<string> {
  const set = new Set<string>();
  for (const r of raw) {
    set.add(PLATFORM_BUCKETS[r] || "other");
  }
  if (set.size === 0) set.add("other");
  return set;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "30", 10)));
  const category = sp.get("category") || "";
  const severity = sp.get("severity") || "";
  const status = sp.get("status") || "";
  const sourceType = sp.get("sourceType") || "";
  const platformBucket = sp.get("platformBucket") || "";
  const q = sp.get("q") || "";
  const technique = (sp.get("technique") || "").trim().toUpperCase();
  const withRules = sp.get("withRules") === "1";

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (severity) where.severity = severity;
  if (status) where.status = status;
  if (sourceType) where.sourceType = sourceType;
  // Filter packs whose ATT&CK technique list contains the given id (JSON string
  // stored, so a substring match on the quoted id is the sound check).
  if (technique) where.mitreTechniques = { contains: `"${technique}"` };
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
      { sourceRefId: { contains: q } },
    ];
  }
  // Platform-bucket filter: translate to an OR of substring matches on the
  // JSON-encoded `platforms` column.
  if (platformBucket) {
    const raws = BUCKET_TO_RAW[platformBucket];
    if (platformBucket === "other") {
      // "other" = no recognised platform string at all; cheapest sound check
      // is `platforms = "[]"`.
      where.platforms = "[]";
    } else if (raws?.length) {
      const orClause = raws.map((r) => ({ platforms: { contains: `"${r}"` } }));
      // Merge with any existing OR (from text search) by AND'ing
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: orClause }];
        delete where.OR;
      } else {
        where.OR = orClause;
      }
    }
  }

  const [rows, total] = await Promise.all([
    prisma.detectionPack.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { rules: true, simulations: true } },
        irPlaybook: { select: { id: true } },
        ...(withRules ? { rules: { select: { id: true, title: true, body: true, format: true, language: true } } } : {}),
      },
    }),
    prisma.detectionPack.count({ where: where as any }),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    severity: r.severity,
    riskScore: r.riskScore,
    category: r.category,
    platforms: safeJson<string[]>(r.platforms, []),
    dataSources: safeJson<string[]>(r.dataSources, []),
    mitreTechniques: safeJson<string[]>(r.mitreTechniques, []),
    mitreTactics: safeJson<string[]>(r.mitreTactics, []),
    status: r.status,
    sourceType: r.sourceType,
    sourceTable: r.sourceTable,
    sourceRefId: r.sourceRefId,
    githubIssueUrl: r.githubIssueUrl,
    ruleCount: r._count.rules,
    simulationCount: r._count.simulations,
    hasIrPlaybook: !!r.irPlaybook,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(withRules ? { rules: (r as any).rules || [] } : {}),
  }));

  // Aggregate counts for the filter sidebar on page 1
  let stats: any = null;
  if (page === 1) {
    const [byCategory, bySeverity, byStatus, allPlatformRows, totalUnfiltered] = await Promise.all([
      prisma.detectionPack.groupBy({ by: ["category"], _count: true }),
      prisma.detectionPack.groupBy({ by: ["severity"], _count: true }),
      prisma.detectionPack.groupBy({ by: ["status"], _count: true }),
      // Unfiltered scan of just the platforms column for the bucket tally —
      // SQLite can't groupBy across JSON-array contents, so we parse in app.
      prisma.detectionPack.findMany({ select: { platforms: true } }),
      prisma.detectionPack.count(),
    ]);

    // Tally each bucket. A pack counts toward every bucket it touches (so
    // a multi-platform pack like ["windows","linux"] adds 1 to each).
    const bucketCounts: Record<string, number> = {};
    for (const b of KNOWN_BUCKETS) bucketCounts[b] = 0;
    for (const row of allPlatformRows) {
      const raws = safeJson<string[]>(row.platforms, []);
      const buckets = bucketize(raws);
      for (const b of buckets) bucketCounts[b] = (bucketCounts[b] || 0) + 1;
    }

    stats = {
      totalPacks: totalUnfiltered,
      byCategory: byCategory.map((x) => ({ name: x.category, count: x._count })),
      bySeverity: bySeverity.map((x) => ({ name: x.severity, count: x._count })),
      byStatus: byStatus.map((x) => ({ name: x.status, count: x._count })),
      byPlatformBucket: KNOWN_BUCKETS.map((b) => ({ name: b, count: bucketCounts[b] })),
    };
  }

  return NextResponse.json({
    items, total, page, pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    stats,
  });
}
