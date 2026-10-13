/**
 * GET /api/apt/groups — list APT groups in the library, filtered by the browse
 * facets. Query params:
 *   country=<name>   APT attribution origin ("Unattributed" for none)
 *   sector=<name>    targeted sector (matches a group's primarySectors)
 *   type=<actorType> apt | campaign | ransomware | criminal | malware | unknown
 *   q=<search>       name / alias substring
 *   sort=atomics|name  (default atomics desc)
 * Returns lightweight group summaries for the catalog grid.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const country = (sp.get("country") || "").trim();
  const sector = (sp.get("sector") || "").trim();
  const type = (sp.get("type") || "").trim();
  const q = (sp.get("q") || "").trim().toLowerCase();
  const sort = sp.get("sort") === "name" ? "name" : "atomics";
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const pageSize = [25, 50, 100, 200].includes(Number(sp.get("page_size"))) ? Number(sp.get("page_size")) : 25;

  const where: Record<string, unknown> = {};
  if (country) where.originCountry = country === "Unattributed" ? "" : country;
  if (type) where.actorType = type;

  let groups = await prisma.aptGroup.findMany({ where });

  const parse = (s: string) => { try { return JSON.parse(s || "[]") as string[]; } catch { return []; } };

  // sector + search filter in JS (sectors/aliases are JSON columns)
  if (sector) groups = groups.filter((g) => parse(g.primarySectors).includes(sector) || parse(g.sectors).includes(sector));
  if (q) groups = groups.filter((g) => g.name.toLowerCase().includes(q) || parse(g.aliases).some((a) => a.toLowerCase().includes(q)));

  groups.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.atomicCount - a.atomicCount || a.name.localeCompare(b.name)));

  const total = groups.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = groups.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize);

  const items = paged.map((g) => ({
    name: g.name,
    mitreId: g.mitreId,
    originCountry: g.originCountry || "",
    originCode: g.originCode || "",
    actorType: g.actorType,
    aliases: parse(g.aliases),
    primarySectors: parse(g.primarySectors),
    sectors: parse(g.sectors),
    tactics: parse(g.tactics),
    atomicCount: g.atomicCount,
  }));

  return NextResponse.json({ total, page: safePage, pageSize, totalPages, items, filters: { country, sector, type, q, sort } });
}
