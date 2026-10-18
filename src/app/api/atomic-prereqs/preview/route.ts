import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

// POST /api/atomic-prereqs/preview
// body: { techniques: ["T1046", "T1003.001", ...], platform? = "windows" }
//
// Declared-dependency preview for a set of techniques. DB-only — it never
// touches the endpoint, so it is cheap and safe to call as the user is about to
// launch a simulation. Returns, for every (technique, testNumber) among the
// given techniques that declares an external dependency, the human descriptions
// of what it needs plus a coarse `klass` so the UI can pre-tick the ones we can
// install automatically and flag the ones a human must provision.
//
// This drives the pre-launch "select which dependencies to install" prompt; the
// actual install is done by POST /api/atomic-prereqs for the selected items.

// Commercial / licensed / interactive tools our online GetPrereqs staging cannot
// place on its own — surfaced as `manual` so the user is not misled into
// thinking a tick will install them.
const MANUAL_PATTERNS: RegExp[] = [
  /radmin/i, /pdq\s*deploy/i, /netsupport/i, /msp360/i, /crackmapexec/i,
  /microsoft (word|excel|office|powerpoint|outlook)/i, /\boffice\b/i, /\bvba\b/i,
  /telnet c2|c2 server/i, /onedrive/i, /softperfect|netscan/i,
  /windows terminal/i, /mpcmdrun|microsoft defender/i, /winget/i,
];

function classify(desc: string): "auto" | "manual" {
  return MANUAL_PATTERNS.some((re) => re.test(desc)) ? "manual" : "auto";
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const platform = String(body.platform || "windows").toLowerCase();
  const raw = Array.isArray(body.techniques) ? body.techniques : [];
  const techniques = Array.from(
    new Set(
      raw
        .map((t: unknown) => String(t || "").toUpperCase())
        .filter((t: string) => /^T\d{4}(\.\d{3})?$/.test(t))
    )
  ).slice(0, 200);
  if (techniques.length === 0) {
    return NextResponse.json({ items: [], hasAuto: false, hasManual: false });
  }

  const rows = await prisma.atomicTest.findMany({
    where: { techniqueId: { in: techniques as string[] } },
    select: {
      techniqueId: true, testNumber: true, testName: true,
      platforms: true, dependencies: true,
    },
    orderBy: [{ techniqueId: "asc" }, { testNumber: "asc" }],
  });

  type Dep = { description: string; klass: "auto" | "manual" };
  type Item = { tech: string; num: number; testName: string; deps: Dep[]; klass: "auto" | "manual" };
  const items: Item[] = [];

  for (const r of rows) {
    // Platform gate — only surface tests runnable on the chosen platform.
    let plats: string[] = [];
    try { plats = JSON.parse(r.platforms || "[]"); } catch { /* ignore */ }
    if (platform && plats.length && !plats.map((p) => p.toLowerCase()).includes(platform)) continue;

    let parsed: Array<Record<string, unknown>> = [];
    try { parsed = JSON.parse(r.dependencies || "[]"); } catch { /* ignore */ }
    if (!Array.isArray(parsed) || parsed.length === 0) continue;

    const deps: Dep[] = parsed
      .map((d) => String(d?.description || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((description) => ({ description, klass: classify(description) }));
    if (deps.length === 0) continue;

    // An atomic is "manual" only if every one of its declared deps is manual;
    // if any dep is auto-installable the whole item is offered as auto.
    const klass: "auto" | "manual" = deps.some((d) => d.klass === "auto") ? "auto" : "manual";
    items.push({ tech: r.techniqueId, num: r.testNumber, testName: r.testName, deps, klass });
  }

  return NextResponse.json({
    items,
    hasAuto: items.some((i) => i.klass === "auto"),
    hasManual: items.some((i) => i.klass === "manual"),
  });
}
