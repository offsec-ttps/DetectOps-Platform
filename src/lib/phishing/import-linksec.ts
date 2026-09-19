/**
 * Import the LinkSec phishing email templates (github.com/LinkSec/phishing-templates,
 * /emails) into our PhishingTemplate store AND clone the raw files to
 * packs/phishing/email-templates/<brand>/<file>. These are full HTML emails for
 * AUTHORIZED security-awareness simulation (training use).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

const REPO = "LinkSec/phishing-templates";
const BRANCH = process.env.LINKSEC_BRANCH || "main";
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW = (p: string) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p}`;
const PACK_DIR = () => path.join(process.cwd(), "packs", "phishing", "email-templates");
const MAX_BODY = 250_000;

// Public repo — no auth header (a stale GITHUB_TOKEN would 401). One recursive
// trees call lists everything; files are fetched from raw.githubusercontent.
async function gh(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "detectops-phishing-import/1.0" } });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  return res.json();
}

function humanize(file: string): string {
  return file.replace(/\.html?$/i, "").replace(/-modified$/i, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}
function titleCaseBrand(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function subjectFromHtml(html: string, fallback: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (t && t.length > 3 && !/^untitled/i.test(t)) return t.replace(/\s+/g, " ").slice(0, 200);
  // common email preheader (hidden span at top)
  const pre = html.match(/preheader[^>]*>([\s\S]{4,120}?)</i)?.[1]?.trim();
  if (pre) return pre.replace(/\s+/g, " ");
  return fallback;
}
function categorize(name: string): { category: string; techniques: string[] } {
  const n = name.toLowerCase();
  if (/(reward|gift|offer|subscription|prize|bonus)/.test(n)) return { category: "link", techniques: ["T1566.002", "T1204.001"] };
  if (/(verif|security|account|update|login|sign[\s-]?in|password|alert)/.test(n)) return { category: "credential-harvest", techniques: ["T1566.002", "T1204.001"] };
  return { category: "credential-harvest", techniques: ["T1566.002"] };
}

export async function importLinkSecEmails(): Promise<{ imported: number; skipped: number; brands: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0, skipped = 0;
  const tree = await gh(TREE_API);
  const entries: Array<{ path: string }> = Array.isArray(tree?.tree) ? tree.tree : [];
  // emails/<brand>/<file>.html
  const htmlFiles = entries.filter((e) => /^emails\/[^/]+\/[^/]+\.html?$/i.test(e.path));
  const brandSet = new Set(htmlFiles.map((e) => e.path.split("/")[1]));
  if (htmlFiles.length === 0) throw new Error("no emails/*.html found in repo tree");

  for (const e of htmlFiles) {
    const [, brand, file] = e.path.split("/");
    const brandTitle = titleCaseBrand(brand);
    try {
      const html = await (await fetch(RAW(e.path), { headers: { "User-Agent": "detectops-phishing-import/1.0" } })).text();
      if (!html || html.length > MAX_BODY) { skipped++; continue; }
      await fs.mkdir(path.join(PACK_DIR(), brand), { recursive: true }).catch(() => {});
      await fs.writeFile(path.join(PACK_DIR(), brand, file), html, "utf8").catch(() => {});

      const label = humanize(file);
      const name = `${brandTitle} — ${label}`.slice(0, 240);
      const { category, techniques } = categorize(file);
      const subject = subjectFromHtml(html, `${brandTitle}: ${label}`);

      const exists = await prisma.phishingTemplate.findUnique({ where: { name } });
      if (exists) { skipped++; continue; }
      await prisma.phishingTemplate.create({
        data: {
          name, category, kind: "email", subject, body: html,
          placeholders: "[]", techniques: JSON.stringify(techniques),
          sourceRef: `LinkSec/phishing-templates · ${e.path}`, license: "see LinkSec repo (training-use)",
        },
      });
      imported++;
    } catch (err: any) { errors.push(`${e.path}: ${err?.message || err}`); }
  }
  return { imported, skipped, brands: brandSet.size, errors: errors.slice(0, 20) };
}
