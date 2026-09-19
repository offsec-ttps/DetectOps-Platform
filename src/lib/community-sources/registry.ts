/**
 * Community Source Registry
 *
 * Single point of discovery for every detection content source on the platform.
 *
 * BACKWARD COMPATIBILITY GUARANTEE:
 *   - Existing SigmaHQ / Elastic / Splunk / Atomic syncs are wrapped here, NOT
 *     replaced. Their existing API routes and UI pages keep working unchanged.
 *   - The wrappers delegate to the original sync functions.
 *   - New sources (MITRE CAR, etc) write into the unified `community_rules`
 *     table via their own adapter implementations.
 */

import type { ICommunitySourceAdapter, SourceStatus } from "./types";
import { flags, isSourceEnabled } from "./flags";

// ── Wrappers for existing legacy sources ──
//
// We import dynamically inside sync() to avoid pulling in heavy fetch code
// at registry init time and to keep the existing modules untouched.

const sigmaHqAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "sigmahq",
    name: "SigmaHQ",
    type: "sigma",
    category: "sigma-native",
    url: "https://github.com/SigmaHQ/sigma",
    description: "Generic SIEM rule format. The largest open Sigma rule corpus.",
    sigmaConvertible: true,
    nativeUI: true, // /community/sigmahq exists already
    legacy: true,
  }),
  async sync() {
    const { syncSigmaHQ } = await import("@/lib/sigmahq/sync");
    const r = await syncSigmaHQ();
    return {
      newCount: r.newCount,
      modifiedCount: r.modifiedCount,
      deletedCount: r.deletedCount,
      totalAfterSync: r.totalAfterSync,
      errors: r.errors.map((message) => ({ message })),
    };
  },
};

const elasticAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "elastic",
    name: "Elastic Detection Rules",
    type: "elastic",
    category: "siem-native",
    url: "https://github.com/elastic/detection-rules",
    description: "Official Elastic Security detection rules in TOML.",
    sigmaConvertible: false,
    nativeUI: true, // /community/elastic exists already
    legacy: true,
  }),
  async sync() {
    const { syncElasticRules } = await import("@/lib/elastic/sync");
    const r = await syncElasticRules();
    return {
      newCount: r.newCount,
      modifiedCount: r.modifiedCount,
      deletedCount: r.deletedCount,
      totalAfterSync: r.totalAfterSync,
      errors: r.errors.map((message) => ({ message })),
    };
  },
};

const splunkAdapter: ICommunitySourceAdapter = {
  meta: () => ({
    id: "splunk",
    name: "Splunk Security Content",
    type: "splunk",
    category: "siem-native",
    url: "https://github.com/splunk/security_content",
    description: "Official Splunk Enterprise Security detection content.",
    sigmaConvertible: false,
    nativeUI: true, // /community/splunk exists already
    legacy: true,
  }),
  async sync() {
    const { syncSplunkDetections } = await import("@/lib/splunk/sync");
    const r = await syncSplunkDetections();
    // Splunk's sync returns SplunkSyncResult with slightly different field names —
    // normalize so the registry sees a unified shape.
    return {
      newCount: r.newCount ?? 0,
      modifiedCount: r.updatedCount ?? 0,
      deletedCount: r.removedCount ?? 0,
      totalAfterSync: r.totalDetections ?? 0,
      errors: (r.errors ?? []).map((message) => ({ message })),
    };
  },
};

// ── New adapters (Phase 2+) ──
// Loaded dynamically and only registered if their feature flag is on.

async function loadNewAdapters(): Promise<ICommunitySourceAdapter[]> {
  const out: ICommunitySourceAdapter[] = [];

  if (isSourceEnabled("mitreCar")) {
    out.push((await import("./adapters/mitre-car")).mitreCarAdapter);
  }
  if (isSourceEnabled("sentinel")) {
    out.push((await import("./adapters/sentinel")).sentinelAdapter);
  }
  if (isSourceEnabled("defenderXdr")) {
    out.push((await import("./adapters/defender-xdr")).defenderXdrAdapter);
  }
  if (isSourceEnabled("googleSecops")) {
    out.push((await import("./adapters/google-secops")).googleSecopsAdapter);
  }
  if (isSourceEnabled("panther")) {
    out.push((await import("./adapters/panther")).pantherAdapter);
  }
  if (isSourceEnabled("falco")) {
    out.push((await import("./adapters/falco")).falcoAdapter);
  }
  if (isSourceEnabled("wazuh")) {
    out.push((await import("./adapters/wazuh")).wazuhAdapter);
  }

  return out;
}

const legacyAdapters: ICommunitySourceAdapter[] = [
  sigmaHqAdapter,
  elasticAdapter,
  splunkAdapter,
];

/** Returns ALL adapters (legacy always-on + new sources gated by flags). */
export async function getAllAdapters(): Promise<ICommunitySourceAdapter[]> {
  const newOnes = await loadNewAdapters();
  return [...legacyAdapters, ...newOnes];
}

export async function getAdapter(id: string): Promise<ICommunitySourceAdapter | null> {
  const all = await getAllAdapters();
  return all.find((a) => a.meta().id === id) || null;
}

/**
 * Compose a unified status snapshot for the registry UI.
 * Reads CommunitySource rows for legacy + unified rules.
 */
export async function getRegistryStatus(): Promise<SourceStatus[]> {
  const { prisma } = await import("@/lib/prisma");
  const adapters = await getAllAdapters();
  const sources = await prisma.communitySource.findMany();
  const sourceByName = new Map(sources.map((s) => [s.name, s]));

  return adapters.map((a) => {
    const meta = a.meta();
    const dbRow = sourceByName.get(meta.name);
    const flagKey = (
      meta.id === "sigmahq" || meta.id === "elastic" || meta.id === "splunk"
        ? "expansion"
        : meta.id === "mitre-car"   ? "mitreCar"
        : meta.id === "sentinel"    ? "sentinel"
        : meta.id === "defender-xdr" ? "defenderXdr"
        : meta.id === "google-secops" ? "googleSecops"
        : meta.id === "panther"     ? "panther"
        : meta.id === "falco"       ? "falco"
        : meta.id === "wazuh"       ? "wazuh"
        : "expansion"
    ) as keyof typeof flags;

    return {
      id: meta.id,
      name: meta.name,
      type: meta.type,
      category: meta.category,
      description: meta.description,
      url: meta.url,
      // Legacy adapters are always considered "enabled" — the master expansion
      // flag does not gate them; they're the existing platform behavior.
      enabled: meta.legacy ? true : isSourceEnabled(flagKey),
      registered: !!dbRow,
      totalRules: dbRow?.totalRules ?? 0,
      lastSyncAt: dbRow?.lastSyncAt?.toISOString() ?? null,
      capabilities: {
        sigmaConvertible: meta.sigmaConvertible,
        nativeUI: meta.nativeUI,
      },
    };
  });
}
