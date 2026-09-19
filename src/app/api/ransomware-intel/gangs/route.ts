/**
 * GET /api/ransomware-intel/gangs — list/search/filter gangs (session-auth, UI).
 * Auto-seeds the curated baseline on first call so the page is never empty.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { isIntelEnabled } from "@/lib/ransomware-intel/flags";
import { ensureSeeded } from "@/lib/ransomware-intel/seed";

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isIntelEnabled()) return NextResponse.json({ items: [], enabled: false });

  await ensureSeeded().catch(() => {});

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").toLowerCase().trim();
  const status = sp.get("status") || "";
  const sector = sp.get("sector") || "";

  const where: any = {};
  if (status) where.status = status;
  const rows = await prisma.ransomwareGang.findMany({ where, orderBy: [{ victimCount: "desc" }, { name: "asc" }], take: 500 });

  const items = rows
    .map((r) => ({
      name: r.name, aliases: j<string[]>(r.aliases, []), status: r.status, description: r.description,
      screenshotRef: r.screenshotRef, knownTTPs: j<any[]>(r.knownTTPs, []), targetSectors: j<string[]>(r.targetSectors, []),
      victimCount: r.victimCount, source: r.source, hasTTPs: j<any[]>(r.knownTTPs, []).length > 0, updatedAt: r.updatedAt,
    }))
    .filter((g) => (!q || g.name.toLowerCase().includes(q) || g.aliases.some((a) => a.toLowerCase().includes(q))))
    .filter((g) => (!sector || g.targetSectors.some((s) => s.toLowerCase().includes(sector.toLowerCase()))));

  return NextResponse.json({ items, enabled: true, total: items.length });
}
