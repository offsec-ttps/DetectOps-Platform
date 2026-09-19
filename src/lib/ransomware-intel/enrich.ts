/**
 * AI enrichment for a gang's TTPs/IOCs/signatures. Reuses the platform LLM
 * dispatcher (runTool, provider auto-selected). Best-effort: failures (no
 * provider/network) return null and the caller keeps curated/empty data.
 */

import { prisma } from "@/lib/prisma";
import { runTool } from "@/lib/llm";

interface EnrichOut {
  techniques: Array<{ id: string; name: string; tactic: string }>;
  iocs: { network: string[]; file: string[]; behavioral: string[] };
  signatures: Array<{ kind: string; name: string; ref?: string }>;
  rationale: string;
}

export async function enrichGang(name: string): Promise<{ ok: boolean; error?: string }> {
  const gang = await prisma.ransomwareGang.findUnique({ where: { name } });
  if (!gang) return { ok: false, error: "gang not found" };

  try {
    const res = await runTool<EnrichOut>({
      system:
        "You are a CTI analyst. For the named ransomware group, return its most-reported MITRE ATT&CK techniques " +
        "(valid IDs like T1486 or T1059.001), representative IOC categories, and detection signature references. " +
        "Be accurate and conservative; only include well-attributed techniques. This is for DEFENSIVE detection-engineering simulation.",
      user:
        `Group: ${gang.name}\nAliases: ${gang.aliases}\nDescription: ${gang.description}\n` +
        `Known sectors: ${gang.targetSectors}\nReturn techniques, IOC categories, and signature refs.`,
      maxTokens: 900,
      tool: {
        name: "gang_intel",
        description: "Record a ransomware group's TTPs, IOCs, and signatures.",
        input_schema: {
          type: "object",
          properties: {
            techniques: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, tactic: { type: "string" } }, required: ["id", "name"] } },
            iocs: { type: "object", properties: { network: { type: "array", items: { type: "string" } }, file: { type: "array", items: { type: "string" } }, behavioral: { type: "array", items: { type: "string" } } } },
            signatures: { type: "array", items: { type: "object", properties: { kind: { type: "string" }, name: { type: "string" }, ref: { type: "string" } }, required: ["kind", "name"] } },
            rationale: { type: "string" },
          },
          required: ["techniques"],
        },
      },
    });
    const d = res.data || ({} as EnrichOut);
    // Keep only valid ATT&CK IDs.
    const techniques = (d.techniques || []).filter((t) => /^T\d{4}(\.\d{3})?$/.test(t.id));
    await prisma.ransomwareGang.update({
      where: { name },
      data: {
        knownTTPs: JSON.stringify(techniques),
        iocs: JSON.stringify(d.iocs || { network: [], file: [], behavioral: [] }),
        signatures: JSON.stringify(d.signatures || []),
        source: gang.source === "seed" ? "seed" : "ai",
        enrichedAt: new Date(),
      },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "AI enrichment unavailable" };
  }
}
