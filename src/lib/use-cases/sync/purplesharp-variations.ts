/**
 * PurpleSharp variation seeder.
 *
 * Reads `purplesharp-variations.seed.json` (parsed from upstream Program.cs)
 * and upserts into `PurpleSharpVariation`. Idempotent; safe to re-run.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

interface SeedEntry {
  technique_id: string;
  technique_name: string;
  variations: Array<{ n: number; label: string }>;
}

export interface SeedResult {
  techniques: number;
  variationsTotal: number;
  upsertedCount: number;
  errors: string[];
}

export async function seedPurpleSharpVariations(): Promise<SeedResult> {
  const seedPath = join(process.cwd(), "src/lib/use-cases/sync/purplesharp-variations.seed.json");
  const raw = await readFile(seedPath, "utf-8");
  const entries = JSON.parse(raw) as SeedEntry[];

  const errors: string[] = [];
  let upsertedCount = 0;
  let variationsTotal = 0;

  for (const e of entries) {
    for (const v of e.variations) {
      variationsTotal++;
      try {
        await prisma.purpleSharpVariation.upsert({
          where: { techniqueId_variation: { techniqueId: e.technique_id, variation: v.n } },
          create: {
            techniqueId: e.technique_id,
            techniqueName: e.technique_name,
            variation: v.n,
            variationLabel: v.label || "",
            requiresUrl: e.technique_id === "T1105",          // ingress tool transfer
            requiresCommand: ["T1059.003", "T1059.001"].some(
              (id) => e.technique_id === id && v.n >= 2,
            ),
            requiredParams: "[]",
            tactic: "",
            description: v.label || "",
          },
          update: {
            techniqueName: e.technique_name,
            variationLabel: v.label || "",
          },
        });
        upsertedCount++;
      } catch (err: any) {
        errors.push(`${e.technique_id} v${v.n}: ${err?.message || err}`);
      }
    }
  }

  return {
    techniques: entries.length,
    variationsTotal,
    upsertedCount,
    errors,
  };
}
