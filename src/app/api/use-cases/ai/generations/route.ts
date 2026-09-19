/**
 * GET /api/use-cases/ai/generations
 *
 * Query:
 *   ?useCaseId=...           — generations for a specific UseCase
 *   ?inputRefType=...&inputRefId=...   — generations for a specific input ref
 *   ?generator=...            — filter by generator name
 *   &page=&pageSize=
 *
 * Also surfaces whether Anthropic is configured server-side so the UI can
 * disable AI buttons gracefully.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isConfigured } from "@/lib/llm/anthropic";

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const where: Record<string, unknown> = {};
  if (sp.get("useCaseId")) where.useCaseId = sp.get("useCaseId");
  if (sp.get("inputRefType") && sp.get("inputRefId")) {
    where.inputRefType = sp.get("inputRefType");
    where.inputRefId = sp.get("inputRefId");
  }
  if (sp.get("generator")) where.generator = sp.get("generator");

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") || "20", 10)));

  const [rows, total] = await Promise.all([
    prisma.aiGeneration.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, useCaseId: true, generator: true, model: true,
        inputRefType: true, inputRefId: true, promptVersion: true,
        inputTokens: true, outputTokens: true, costUsd: true,
        status: true, errorMessage: true, toolName: true, createdAt: true,
      },
    }),
    prisma.aiGeneration.count({ where: where as any }),
  ]);

  // Aggregate totals
  const agg = await prisma.aiGeneration.aggregate({
    where: where as any,
    _sum: { inputTokens: true, outputTokens: true, costUsd: true },
  });

  return NextResponse.json({
    items: rows,
    total, page, pageSize,
    totals: {
      inputTokens: agg._sum.inputTokens || 0,
      outputTokens: agg._sum.outputTokens || 0,
      costUsd: Math.round((agg._sum.costUsd || 0) * 10000) / 10000,
    },
    config: {
      anthropic: isConfigured() ? "configured" : "missing",
      defaultModel: process.env.ANTHROPIC_MODEL_DEFAULT || "claude-sonnet-4-6",
    },
  });
}
