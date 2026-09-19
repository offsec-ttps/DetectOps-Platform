/**
 * PurpleSharp template syncer.
 *
 * Pulls every .json file from mvelazc0/PurpleTeamPlaybook (main branch), parses
 * each as a PurpleSharp playbook, extracts MITRE techniques, and upserts a
 * `PurpleSharpTemplate` row. Idempotent via content hash.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const REPO_OWNER = "mvelazc0";
const REPO_NAME = "PurpleTeamPlaybook";
const REPO_BRANCH = "main";

interface GhTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "detection-platform/purplesharp-templates-sync",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function extractTechniqueIds(playbook: any): string[] {
  const ids = new Set<string>();
  for (const p of playbook?.playbooks || []) {
    for (const t of p?.tasks || []) {
      if (typeof t?.technique_id === "string") ids.add(t.technique_id);
    }
  }
  return [...ids];
}

export interface TemplatesSyncResult {
  treeEntries: number;
  candidatesFound: number;
  upserted: number;
  unchanged: number;
  errors: Array<{ path: string; message: string }>;
}

export async function syncPurpleSharpTemplates(): Promise<TemplatesSyncResult> {
  const result: TemplatesSyncResult = {
    treeEntries: 0,
    candidatesFound: 0,
    upserted: 0,
    unchanged: 0,
    errors: [],
  };

  // 1. Pull the recursive tree of the main branch
  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${REPO_BRANCH}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers: ghHeaders() });
  if (!treeRes.ok) {
    throw new Error(`GitHub tree fetch failed: HTTP ${treeRes.status}`);
  }
  const treeJson = await treeRes.json() as { tree?: GhTreeEntry[] };
  const entries = (treeJson.tree || []).filter((e) =>
    e.type === "blob" && e.path.toLowerCase().endsWith(".json"),
  );
  result.treeEntries = treeJson.tree?.length || 0;
  result.candidatesFound = entries.length;

  // 2. Pull each JSON, parse, upsert
  for (const e of entries) {
    const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${e.path}`;
    let raw: string;
    try {
      const r = await fetch(rawUrl, { headers: ghHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      raw = await r.text();
    } catch (err: any) {
      result.errors.push({ path: e.path, message: err?.message || String(err) });
      continue;
    }

    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch (err: any) {
      result.errors.push({ path: e.path, message: `JSON parse: ${err?.message || err}` });
      continue;
    }

    const techniques = extractTechniqueIds(parsed);
    const segments = e.path.split("/");
    const group = segments.length >= 2 ? segments[segments.length - 2] : "";
    const category = segments[0] || "";
    const name = segments[segments.length - 1].replace(/\.json$/i, "").replace(/_/g, " ");
    const description = parsed?.playbooks?.[0]?.name || "";
    const contentHash = sha256Hex(raw);
    const sourceUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${REPO_BRANCH}/${e.path}`;

    const existing = await prisma.purpleSharpTemplate.findUnique({ where: { scenarioPath: e.path } });
    if (existing && existing.contentHash === contentHash) {
      result.unchanged++;
      continue;
    }
    try {
      await prisma.purpleSharpTemplate.upsert({
        where: { scenarioPath: e.path },
        create: {
          scenarioPath: e.path,
          group, category, name, description,
          rawJson: raw,
          mitreTechniques: JSON.stringify(techniques),
          contentHash,
          sourceUrl,
        },
        update: {
          group, category, name, description,
          rawJson: raw,
          mitreTechniques: JSON.stringify(techniques),
          contentHash,
          sourceUrl,
        },
      });
      result.upserted++;
    } catch (err: any) {
      result.errors.push({ path: e.path, message: err?.message || String(err) });
    }
  }
  return result;
}
