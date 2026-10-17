import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";

const TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

// GET /api/coverage-assessments/:id/download?format=md|docx|pdf
// Serves a rendered report file. The path is taken from the assessment's own
// stored reportPaths (never from the request), so no caller-supplied path.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const format = (new URL(req.url).searchParams.get("format") || "md").toLowerCase();
  if (!TYPES[format]) return NextResponse.json({ error: "format must be md, docx or pdf" }, { status: 400 });

  const a = await prisma.coverageAssessment.findUnique({ where: { id }, select: { reportPaths: true, client: true } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  let paths: Record<string, string> = {};
  try { paths = JSON.parse(a.reportPaths || "{}"); } catch { /* */ }
  const path = paths[format];
  if (!path || !existsSync(path)) return NextResponse.json({ error: `no ${format} report available` }, { status: 404 });

  const buf = readFileSync(path);
  const fname = `coverage-${(a.client || "report").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${format}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
