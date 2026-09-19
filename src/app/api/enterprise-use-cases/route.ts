/**
 * GET /api/enterprise-use-cases — paginated list with filters + platform aggregates
 *
 *   ?status=&validationStatus=&platformBucket=&owner=&q=&page=&pageSize=
 *
 * Platform-bucket logic mirrors the Detection Packs list endpoint: raw
 * platforms (windows / linux / aws / azure-ad / containers / …) are bucketed
 * into UI groups (windows / linux / macos / cloud / saas / container /
 * network / hypervisor / browser / other).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

const PLATFORM_BUCKETS: Record<string, string> = {
  "windows": "windows",
  "linux": "linux",
  "macos": "macos",
  "containers": "container", "container": "container", "docker": "container", "kubernetes": "container",
  "network": "network",
  "aws": "cloud", "azure": "cloud", "gcp": "cloud",
  "iaas": "cloud", "iaas:aws": "cloud", "iaas:azure": "cloud", "iaas:gcp": "cloud",
  "saas": "saas",
  "office-365": "saas", "azure-ad": "saas", "google-workspace": "saas", "okta": "saas", "entra-id": "saas",
  "hypervisor": "hypervisor", "esxi": "hypervisor", "vmware": "hypervisor",
  "browser": "browser", "chrome": "browser", "firefox": "browser",
};
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
  for (const r of raw) set.add(PLATFORM_BUCKETS[r.toLowerCase()] || "other");
  if (set.size === 0) set.add("other");
  return set;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // Tenant scope: only the caller's own use cases when enforcing (dev shows all).
  const tenantScope: Record<string, unknown> = auth.enforced ? { uploadedBy: auth.user.id } : {};

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "30", 10)));
  const status = sp.get("status") || "";
  const validationStatus = sp.get("validationStatus") || "";
  const owner = sp.get("owner") || "";
  const platformBucket = sp.get("platformBucket") || "";
  const q = sp.get("q") || "";
  const dueWithinDays = parseInt(sp.get("dueWithinDays") || "0", 10);

  const where: Record<string, unknown> = { ...tenantScope };
  if (status) where.status = status;
  if (validationStatus) where.validationStatus = validationStatus;
  if (owner) where.owner = owner;
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
      { owner: { contains: q } },
      { sourceFilename: { contains: q } },
    ];
  }
  if (dueWithinDays > 0) {
    const cutoff = new Date(Date.now() + dueWithinDays * 24 * 60 * 60 * 1000);
    where.nextValidationDueAt = { lte: cutoff };
  }
  if (platformBucket) {
    const raws = BUCKET_TO_RAW[platformBucket];
    if (platformBucket === "other") {
      where.platforms = "[]";
    } else if (raws?.length) {
      const orClause = raws.map((r) => ({ platforms: { contains: `"${r}"` } }));
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: orClause }];
        delete where.OR;
      } else {
        where.OR = orClause;
      }
    }
  }

  const [rows, total] = await Promise.all([
    prisma.enterpriseUseCase.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { scenarios: true, runs: true, comments: true } },
      },
    }),
    prisma.enterpriseUseCase.count({ where: where as any }),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    severity: r.severity,
    platforms: safeJson<string[]>(r.platforms, []),
    mitreTechniques: safeJson<string[]>(r.mitreTechniques, []),
    owner: r.owner,
    format: r.format,
    selectedLogic: r.selectedLogic,
    status: r.status,
    validationStatus: r.validationStatus,
    siemCompatibility: safeJson<Record<string, string>>(r.siemCompatibility, {}),
    sourceFilename: r.sourceFilename,
    sourceRowRef: r.sourceRowRef,
    lastValidatedAt: r.lastValidatedAt,
    nextValidationDueAt: r.nextValidationDueAt,
    scenarioCount: r._count.scenarios,
    runCount: r._count.runs,
    commentCount: r._count.comments,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  let stats: any = null;
  if (page === 1) {
    // Scope aggregates to the tenant too, so sidebar counts don't leak totals.
    const sw = tenantScope as any;
    const [byStatus, byValidation, byOwner, allPlatformRows, totalUnfiltered] = await Promise.all([
      prisma.enterpriseUseCase.groupBy({ by: ["status"], where: sw, _count: true }),
      prisma.enterpriseUseCase.groupBy({ by: ["validationStatus"], where: sw, _count: true }),
      prisma.enterpriseUseCase.groupBy({ by: ["owner"], where: sw, _count: true, orderBy: { _count: { owner: "desc" } }, take: 12 }),
      prisma.enterpriseUseCase.findMany({ where: sw, select: { platforms: true } }),
      prisma.enterpriseUseCase.count({ where: sw }),
    ]);
    const bucketCounts: Record<string, number> = {};
    for (const b of KNOWN_BUCKETS) bucketCounts[b] = 0;
    for (const row of allPlatformRows) {
      const raws = safeJson<string[]>(row.platforms, []);
      for (const b of bucketize(raws)) bucketCounts[b] = (bucketCounts[b] || 0) + 1;
    }
    stats = {
      totalUseCases: totalUnfiltered,
      byStatus: byStatus.map((x) => ({ name: x.status, count: x._count })),
      byValidation: byValidation.map((x) => ({ name: x.validationStatus, count: x._count })),
      topOwners: byOwner.filter((x) => x.owner).map((x) => ({ name: x.owner, count: x._count })),
      byPlatformBucket: KNOWN_BUCKETS.map((b) => ({ name: b, count: bucketCounts[b] })),
    };
  }

  return NextResponse.json({
    items, total, page, pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    stats,
  });
}
