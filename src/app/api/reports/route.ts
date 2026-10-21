import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { generateMarkdownReport } from "@/lib/github";
import { logEvent } from "@/lib/event-log";
import { pickReportFields, pickSimulations, parseDate } from "../_shared/report-fields";

// Where locally-saved detection reports are written on disk. Override with
// REPORTS_LOCAL_DIR; defaults to <cwd>/reports/local.
function reportsLocalDir(): string {
  const raw = process.env.REPORTS_LOCAL_DIR;
  if (raw && raw.trim()) {
    let p = raw.trim();
    if (p === "~") p = process.env.HOME || p;
    else if (p.startsWith("~/")) p = path.join(process.env.HOME || "", p.slice(2));
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  return path.join(process.cwd(), "reports", "local");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "report";
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") || "25", 10)));
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const severity = searchParams.get("severity") || "";

  const where: Record<string, unknown> = {};
  if (search) where.OR = [{ name: { contains: search } }, { description: { contains: search } }];
  if (status) where.status = status;
  if (severity) where.severity = severity;

  const [items, total] = await Promise.all([
    prisma.detectionReport.findMany({
      where: where as any,
      include: { simulations: { orderBy: { order: "asc" } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.detectionReport.count({ where: where as any }),
  ]);

  return NextResponse.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fields = pickReportFields(body || {});

  if (!fields.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const report = await prisma.detectionReport.create({
    data: {
      ...(fields as any),
      startDate: parseDate(body.startDate),
      endDate: parseDate(body.endDate),
      simulations: { create: pickSimulations(body.simulations) },
    },
    include: { simulations: { orderBy: { order: "asc" } } },
  });

  // Also render the report to markdown and save it to the local filesystem, so
  // "Save Report Locally" produces a real file the user can open — and we return
  // its path. The subsequent GitHub-push flow (if requested) is unchanged.
  let localPath: string | null = null;
  let localWriteError: string | null = null;
  try {
    const dir = reportsLocalDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const fileName = `${slugify(report.name)}_${report.id.slice(0, 8)}.md`;
    const fullPath = path.join(dir, fileName);
    const markdown = generateMarkdownReport({
      ...(report as any),
      startDate: report.startDate?.toISOString() || null,
      endDate: report.endDate?.toISOString() || null,
      simulations: report.simulations.map((s) => ({
        description: s.description, output: s.output, order: s.order,
      })),
    });
    writeFileSync(fullPath, markdown, "utf-8");
    localPath = fullPath;
    void logEvent({
      category: "report", action: "report.save_local", status: "ok",
      targetType: "report", targetId: report.id,
      message: `saved report to ${fullPath}`,
      details: { path: fullPath, name: report.name },
    });
  } catch (err) {
    localWriteError = err instanceof Error ? err.message : String(err);
    void logEvent({
      category: "report", action: "report.save_local", status: "error",
      targetType: "report", targetId: report.id,
      message: localWriteError, errorMessage: localWriteError,
    });
  }

  return NextResponse.json({ ...report, localPath, localWriteError }, { status: 201 });
}
