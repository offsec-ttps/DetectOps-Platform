/** GET /api/phishing/templates — seeded training template library (Mode A). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { ensurePhishingTemplates } from "@/lib/phishing/templates-seed";

function j<T>(s: string, fb: T): T { try { return JSON.parse(s) as T; } catch { return fb; } }

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  await ensurePhishingTemplates().catch(() => {});
  const rows = await prisma.phishingTemplate.findMany({ orderBy: { category: "asc" } });
  return NextResponse.json({
    items: rows.map((r) => ({ id: r.id, name: r.name, category: r.category, kind: r.kind, subject: r.subject, body: r.body, placeholders: j<string[]>(r.placeholders, []), techniques: j<string[]>(r.techniques, []), license: r.license, sourceRef: r.sourceRef })),
  });
}
