import { prisma } from "@/lib/prisma";
import https from "https";
import crypto from "crypto";

const API_BASE = "https://intel.threadlinqs.com/api/v1";
const API_KEY = "<REDACTED-ROTATE>";

// ── API request helper ──

function tlRequest(path: string, token?: string): Promise<any> {
  const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token || API_KEY}`,
          Accept: "application/json",
          "User-Agent": "DetectOps/1.0",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve(raw); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("Threadlinqs API timeout")); });
    req.end();
  });
}

// ── Fetch threats (paginated) ──

export async function fetchThreats(offset = 0, limit = 100, token?: string): Promise<{ data: any[]; pagination: any }> {
  return tlRequest(`/threats?offset=${offset}&limit=${limit}`, token);
}

// ── Fetch single threat detail ──

export async function fetchThreatDetail(id: string, token?: string): Promise<any> {
  return tlRequest(`/threats/${id}`, token);
}

// ── Full sync to local DB ──

export async function syncAllThreats(token?: string): Promise<{
  newCount: number; updatedCount: number; totalThreats: number;
}> {
  const syncRun = await prisma.threatIntelSyncMeta.create({
    data: { status: "running" },
  });

  try {
    let offset = 0;
    const limit = 100;
    let newCount = 0;
    let updatedCount = 0;
    let totalFetched = 0;

    while (true) {
      const result = await fetchThreats(offset, limit, token);
      const threats = result.data || [];
      if (threats.length === 0) break;

      for (const t of threats) {
        const hash = crypto.createHash("sha256").update(JSON.stringify(t)).digest("hex");

        const existing = await prisma.threatIntelReport.findUnique({
          where: { threatId: t.id },
        });

        const data = {
          threatId: t.id,
          title: t.title || "",
          summary: t.summary || "",
          description: t.description || "",
          severityLevel: t.severity_level || t.severity?.level || "",
          cvssScore: t.cvss_score || t.severity?.cvss_score || 0,
          category: t.category || "",
          status: t.status || "",
          exploitability: t.exploitability || "",
          threatActor: t.threat_actor || t.attribution?.threat_actor || "",
          threatActorAliases: JSON.stringify(t.threat_actor_aliases || t.aliases || []),
          nationState: t.nation_state || t.attribution?.nation_state || "",
          motivation: t.motivation || t.attribution?.motivation || "",
          attributionConfidence: t.attribution_confidence || t.attribution?.confidence || "",
          mitreTechniques: JSON.stringify(t.mitre_attack || []),
          iocs: JSON.stringify(t.iocs || {}),
          detections: JSON.stringify(t.detections || []),
          detectionCount: t.detection_count || (t.detections || []).length,
          timeline: JSON.stringify(t.timeline || []),
          references: JSON.stringify(t.references || []),
          remediation: JSON.stringify(t.remediation || {}),
          targetSectors: JSON.stringify(t.target_sectors || []),
          targetRegions: JSON.stringify(t.target_regions || []),
          tags: JSON.stringify(t.tags || []),
          affected: JSON.stringify(t.affected || []),
          contentHash: hash,
          sourceCreated: t.created ? new Date(t.created) : null,
          sourceUpdated: t.updated ? new Date(t.updated) : null,
          syncedAt: new Date(),
        };

        if (!existing) {
          await prisma.threatIntelReport.create({ data });
          newCount++;
        } else if (existing.contentHash !== hash) {
          await prisma.threatIntelReport.update({ where: { threatId: t.id }, data });
          updatedCount++;
        }
        totalFetched++;
      }

      if (!result.pagination?.has_more) break;
      offset += limit;
    }

    await prisma.threatIntelSyncMeta.update({
      where: { id: syncRun.id },
      data: {
        status: "completed",
        newCount,
        updatedCount,
        totalThreats: totalFetched,
        completedAt: new Date(),
      },
    });

    return { newCount, updatedCount, totalThreats: totalFetched };
  } catch (err) {
    await prisma.threatIntelSyncMeta.update({
      where: { id: syncRun.id },
      data: {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
    throw err;
  }
}
