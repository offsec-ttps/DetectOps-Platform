import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateMarkdownReport } from "@/lib/github";
import { renderMarkdownTo, REPORT_MIME, type ReportFormat } from "@/lib/reports/convert";

// GET /api/reports/:id/download?format=md|docx|pdf
// Renders a saved per-run detection report on demand and streams it back as a
// download. The Markdown is generated from the report's own stored fields (the
// same renderer used when the report is saved to disk / pushed to GitHub); docx
// and pdf are converted from that Markdown. The path/content is never taken from
// the request — only the whitelisted format is.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = (new URL(req.url).searchParams.get("format") || "md").toLowerCase();
  if (format !== "md" && format !== "docx" && format !== "pdf") {
    return NextResponse.json({ error: "format must be md, docx or pdf" }, { status: 400 });
  }

  const report = await prisma.detectionReport.findUnique({
    where: { id },
    include: { simulations: { orderBy: { order: "asc" } } },
  });
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

  const markdown = generateMarkdownReport({
    ...(report as any),
    startDate: report.startDate?.toISOString() || null,
    endDate: report.endDate?.toISOString() || null,
    simulations: report.simulations.map((s) => ({ description: s.description, output: s.output, order: s.order })),
  });

  const base = report.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  let bytes: Buffer;
  try {
    bytes = await renderMarkdownTo(markdown, base, format as ReportFormat);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "render failed" }, { status: 503 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": REPORT_MIME[format as ReportFormat],
      "Content-Disposition": `attachment; filename="${base}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
