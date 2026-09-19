/**
 * Transactional writer for a freshly-generated Detection Pack.
 *
 * Atomically creates:
 *   - DetectionPack             (metadata + categorisation)
 *   - DetectionRule × N         (one per format)
 *   - IrPlaybook                (tiered structured steps)
 *   - DetectionSimulation × M   (inferred ART/PurpleSharp/Stratus matches)
 *
 * If any step throws we roll back so the user never sees a half-saved pack.
 */

import { prisma } from "@/lib/prisma";
import type { SimDraft } from "./infer-sims";

export interface PackPersistInput {
  sourceType: "ti" | "rule";
  sourceTable: string;
  sourceRefId: string;
  generatorRunId?: string;
  packTool: {
    name: string;
    description: string;
    severity: string;
    riskScore: number;
    category: string;
    platforms: string[];
    dataSources: string[];
    mitreTechniques: string[];
    mitreTactics?: string[];
    references?: Array<{ title: string; url: string; type: string }>;
    rules: Array<{
      format: string; title: string; body: string;
      language?: string; falsePositives?: string[];
    }>;
  };
  irpTool?: {
    summary: string;
    l1Steps: unknown[];
    l2Steps: unknown[];
    l3Steps: unknown[];
    containment: unknown[];
    eradication: unknown[];
    recovery: unknown[];
  };
  simulations?: SimDraft[];
}

function baseSlug(name: string, sourceRefId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);
  const suffix = sourceRefId.replace(/-/g, "").slice(0, 6) || Math.random().toString(36).slice(2, 8);
  return `${base || "pack"}-${suffix}`;
}

/**
 * Resolve the next unique slug. The first save uses the base form; subsequent
 * regens append `-v2`, `-v3`, … so historic packs and their GitHub issues
 * stay linked.
 */
async function resolveUniqueSlug(tx: { detectionPack: { findUnique: (a: any) => Promise<{ id: string } | null> } }, name: string, sourceRefId: string, salt = ""): Promise<string> {
  const base = `${baseSlug(name, sourceRefId)}${salt}`;
  const existing = await tx.detectionPack.findUnique({ where: { slug: base } });
  if (!existing) return base;
  // Walk up versions until we find a free one. Cap at 100 — anything beyond
  // that is the caller's problem.
  for (let v = 2; v <= 100; v++) {
    const candidate = `${base}-v${v}`;
    const taken = await tx.detectionPack.findUnique({ where: { slug: candidate } });
    if (!taken) return candidate;
  }
  // Pathological fallback — collision unlikely
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function persistPack(input: PackPersistInput) {
  const p = input.packTool;
  // resolveUniqueSlug does findUnique-then-create with no lock, so two
  // concurrent generations for the same source can compute the same slug and
  // race to create it — the loser hits the @unique(slug) constraint (P2002).
  // Retry with an extra random salt so the collision resolves instead of
  // bubbling up as a (retryable) error that re-spends LLM tokens.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const salt = attempt === 0 ? "" : `-${Math.random().toString(36).slice(2, 6)}`;
    try {
      return await persistOnce(input, p, salt);
    } catch (err: any) {
      if (err?.code === "P2002" && attempt < 3) { lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr;
}

async function persistOnce(input: PackPersistInput, p: PackPersistInput["packTool"], slugSalt: string) {
  return await prisma.$transaction(async (tx) => {
    const slug = await resolveUniqueSlug(tx as any, p.name, input.sourceRefId, slugSalt);
    const pack = await tx.detectionPack.create({
      data: {
        name: p.name.slice(0, 240),
        slug,
        description: p.description.slice(0, 4000),
        severity: p.severity,
        riskScore: clampInt(p.riskScore, 0, 100, 50),
        category: p.category,
        platforms: JSON.stringify(p.platforms || []),
        dataSources: JSON.stringify(p.dataSources || []),
        mitreTechniques: JSON.stringify(p.mitreTechniques || []),
        mitreTactics: JSON.stringify(p.mitreTactics || []),
        references: JSON.stringify(p.references || []),
        status: "draft",
        sourceType: input.sourceType,
        sourceTable: input.sourceTable,
        sourceRefId: input.sourceRefId,
        generatorRunId: input.generatorRunId || null,
      },
    });

    if (p.rules?.length) {
      await tx.detectionRule.createMany({
        data: p.rules.slice(0, 8).map((r) => ({
          packId: pack.id,
          format: r.format,
          title: r.title.slice(0, 240),
          body: r.body.slice(0, 32_000),
          language: r.language || "",
          falsePositives: JSON.stringify(r.falsePositives || []),
        })),
      });
    }

    if (input.irpTool) {
      const irp = input.irpTool;
      await tx.irPlaybook.create({
        data: {
          packId: pack.id,
          summary: (irp.summary || "").slice(0, 4000),
          l1Steps: JSON.stringify(irp.l1Steps || []),
          l2Steps: JSON.stringify(irp.l2Steps || []),
          l3Steps: JSON.stringify(irp.l3Steps || []),
          containment: JSON.stringify(irp.containment || []),
          eradication: JSON.stringify(irp.eradication || []),
          recovery: JSON.stringify(irp.recovery || []),
        },
      });
    }

    if (input.simulations?.length) {
      await tx.detectionSimulation.createMany({
        data: input.simulations.map((s) => ({
          packId: pack.id,
          framework: s.framework,
          refId: s.refId,
          techniqueId: s.techniqueId,
          displayName: s.displayName.slice(0, 240),
          description: s.description.slice(0, 2000),
          rationale: s.rationale.slice(0, 1000),
        })),
      });
    }

    return pack;
  });
}

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
