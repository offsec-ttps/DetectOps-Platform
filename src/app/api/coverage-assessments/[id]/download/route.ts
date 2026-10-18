import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";

const TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// GET /api/coverage-assessments/:id/download?format=md|docx|pdf&type=executive|technical
// Serves a rendered report file. Paths come from the assessment's own stored
// reportPaths (never from the request), so no caller-supplied path. `type`
// selects the Executive Summary or the Technical report (default technical).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const format = (sp.get("format") || "md").toLowerCase();
  const type = (sp.get("type") || "technical").toLowerCase();
  if (!TYPES[format]) return NextResponse.json({ error: "format must be md, docx, pdf or pptx" }, { status: 400 });
  if (type !== "executive" && type !== "technical") return NextResponse.json({ error: "type must be executive or technical" }, { status: 400 });

  const a = await prisma.coverageAssessment.findUnique({ where: { id }, select: { reportPaths: true, client: true, ownerId: true } });
  if (!a) return NextResponse.json({ error: "not found" }, { status: 404 });
  const own = ownsOr404(auth, a.ownerId);
  if (!own.ok) return own.response;
  let paths: Record<string, any> = {};
  try { paths = JSON.parse(a.reportPaths || "{}"); } catch { /* */ }
  // Prefer the nested {type:{format}} shape; fall back to the flat (technical) shape.
  const path: string | undefined = paths?.[type]?.[format] || (type === "technical" ? paths[format] : undefined);
  if (!path || !existsSync(path)) return NextResponse.json({ error: `no ${type} ${format} report available` }, { status: 404 });

  const buf = readFileSync(path);
  const fname = `coverage-${(a.client || "report").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${type}.${format}`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
