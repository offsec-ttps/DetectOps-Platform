import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.detectionReport.findUnique({
    where: { id },
    include: { simulations: { orderBy: { order: "asc" } } },
  });
  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(report);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { simulations, ...fields } = body;

  // Delete existing simulations and recreate
  if (simulations) {
    await prisma.reportSimulation.deleteMany({ where: { reportId: id } });
  }

  const report = await prisma.detectionReport.update({
    where: { id },
    data: {
      ...fields,
      startDate: fields.startDate ? new Date(fields.startDate) : undefined,
      endDate: fields.endDate ? new Date(fields.endDate) : undefined,
      ...(simulations ? {
        simulations: {
          create: simulations.map((s: any, i: number) => ({
            description: s.description || "",
            output: s.output || "",
            order: s.order ?? i,
          })),
        },
      } : {}),
    },
    include: { simulations: { orderBy: { order: "asc" } } },
  });

  return NextResponse.json(report);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.detectionReport.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
