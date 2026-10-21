import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getRegistry } from "@/lib/lotl/registry";
import { getLibraryByModule } from "@/lib/attack-sim/registry";
import type { TechniqueDef, CuratedAtomic } from "@/lib/attack-sim/types";
import { classifyExclusion } from "@/lib/coverage-assessment/exclusions";
import {
  normalizeDoc, checkDoc, type EntryDoc, type TechniqueEntryDoc, type LotlEntryDoc,
} from "./schema";

/**
 * Library Entry store + merge layer.
 *
 * An entry is an OVERLAY on an existing library: it is never written into a seeded
 * manifest or a static library file, so first-party content keeps receiving its own
 * updates. Published entries are merged at READ time into:
 *   - the module manifest catalog   (list view, Campaign Designer picker, coverage scope)
 *   - the attack-sim library        (technique cards, detection/mitigation, simulate)
 * LOTL entries are materialised into protected `custom:` rows of the LOTL library.
 */

export const LOTL_PREFIX = "lotl:";
export type EntryStatus = "draft" | "pending" | "published" | "retired";

export interface EntryRow {
  id: string; kind: string; moduleId: string; entryKey: string; name: string; attackId: string;
  status: string; version: number; doc: string; changelog: string; createdBy: string; publishedBy: string;
  publishedAt: Date | null; createdAt: Date; updatedAt: Date;
}

const parseDoc = (row: { doc: string }): EntryDoc | null => { try { return normalizeDoc(JSON.parse(row.doc)); } catch { return null; } };
const hashDoc = (doc: EntryDoc) => createHash("sha256").update(JSON.stringify(doc)).digest("hex").slice(0, 16);

// ── Targets ──────────────────────────────────────────────────────────────────
export interface TargetInfo {
  id: string; name: string; kind: "technique" | "lotl"; view: string; description: string;
  platform?: string; techniqueCount: number; entryCount: number; groups: Array<{ name: string; domains: string[] }>;
}

/** Every library an analyst can add to: catalog-bearing simulation modules + LOTL libraries. */
export async function listTargets(): Promise<TargetInfo[]> {
  const out: TargetInfo[] = [];
  const mods = await prisma.simulationModule.findMany({ select: { moduleId: true, name: true, description: true, manifest: true } });
  const counts = await prisma.libraryEntry.groupBy({ by: ["moduleId"], where: { status: { in: ["published", "pending", "draft"] } }, _count: true }).catch(() => []);
  const cmap = new Map(counts.map((c) => [c.moduleId, c._count]));
  for (const m of mods) {
    let manifest: any; try { manifest = JSON.parse(m.manifest || "{}"); } catch { continue; }
    const cat = manifest?.contributes?.catalog;
    const view = manifest?.contributes?.view || "";
    if (!Array.isArray(cat) || !cat.length) continue;
    if (["phishing-sim", "apt-catalog", "ransomware-intel"].includes(view)) continue; // different data models
    const groups = new Map<string, Set<string>>();
    let n = 0;
    for (const g of cat) { n += (g.techniques || []).length; if (!groups.has(g.name)) groups.set(g.name, new Set()); if (g.domain) groups.get(g.name)!.add(g.domain); }
    const lib = getLibraryByModule(m.moduleId);
    out.push({
      id: m.moduleId, name: m.name, kind: "technique", view, description: m.description,
      techniqueCount: Math.max(n, lib?.techniques.length || 0), entryCount: cmap.get(m.moduleId) || 0,
      groups: [...groups].map(([name, d]) => ({ name, domains: [...d] })),
    });
  }
  const lotlCounts = await prisma.lotlTechnique.groupBy({ by: ["library"], _count: true }).catch(() => []);
  const lmap = new Map(lotlCounts.map((c) => [c.library, c._count]));
  for (const l of getRegistry().meta()) {
    out.push({
      id: `${LOTL_PREFIX}${l.sourceId}`, name: `${l.displayName} (LOTL)`, kind: "lotl", view: "lotl", description: `Living-off-the-Land library — ${l.displayName}`,
      platform: l.platform, techniqueCount: lmap.get(l.sourceId) || 0, entryCount: cmap.get(`${LOTL_PREFIX}${l.sourceId}`) || 0, groups: [],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Validation (structure + DB-backed checks) ────────────────────────────────
export interface ResolvedLink { technique: string; name_includes: string[]; matched: Array<{ testNumber: number; testName: string; platforms: string[] }> }
export interface ValidationResult {
  ok: boolean; errors: string[]; warnings: string[]; doc: EntryDoc;
  target?: TargetInfo; resolved: ResolvedLink[]; exists: boolean; nextVersion: number;
}

export async function validateEntry(raw: unknown, opts: { admin?: boolean } = {}): Promise<ValidationResult> {
  const doc = normalizeDoc(raw);
  const { errors, warnings } = checkDoc(doc);
  const resolved: ResolvedLink[] = [];
  const targets = await listTargets();
  const target = targets.find((t) => t.id === doc.library);
  if (doc.library && !target) errors.push(`library: "${doc.library}" is not an updatable library — see the target list in the Module Builder`);
  if (target && target.kind !== doc.kind) errors.push(`kind: library "${doc.library}" accepts ${target.kind} entries, not ${doc.kind}`);

  const prev = doc.key && doc.library ? await prisma.libraryEntry.findUnique({ where: { moduleId_entryKey: { moduleId: doc.library, entryKey: doc.key } } }).catch(() => null) : null;

  if (doc.kind === "technique") {
    // Linked atomics must exist locally — link existing vetted tests only.
    for (const a of (doc as TechniqueEntryDoc).atomics) {
      if (!a.technique) continue;
      const rows = await prisma.atomicTest.findMany({ where: { techniqueId: a.technique }, select: { testNumber: true, testName: true, platforms: true }, orderBy: { testNumber: "asc" } });
      const terms = (a.name_includes || []).map((s) => s.toLowerCase());
      const hit = rows.filter((r) => !terms.length || terms.some((t) => r.testName.toLowerCase().includes(t)));
      resolved.push({ technique: a.technique, name_includes: a.name_includes || [], matched: hit.map((r) => ({ testNumber: r.testNumber, testName: r.testName, platforms: (() => { try { return JSON.parse(r.platforms || "[]"); } catch { return []; } })() })) });
      if (!rows.length) errors.push(`atomics: no local atomic tests exist for ${a.technique} — sync the atomic library or use atomics: [] for a coverage-only entry`);
      else if (!hit.length) errors.push(`atomics: none of the ${rows.length} local ${a.technique} tests match name_includes [${(a.name_includes || []).join(", ")}]`);
    }
    // Duplicate-name hint against the library's existing techniques and other entries.
    const lib = getLibraryByModule(doc.library);
    // A key equal to a curated technique key would shadow it (duplicate cards; the
    // simulate resolver would return the curated atomics, never this entry's).
    if (lib?.techniques.some((t) => t.key === doc.key)) errors.push(`key: "${doc.key}" is already used by a built-in technique in this library — choose a different key`);
    const names = new Set<string>((lib?.techniques || []).map((t) => t.name.toLowerCase()));
    const mod = await prisma.simulationModule.findUnique({ where: { moduleId: doc.library }, select: { manifest: true } }).catch(() => null);
    try { for (const g of JSON.parse(mod?.manifest || "{}")?.contributes?.catalog || []) for (const t of g.techniques || []) names.add(String(t.name).toLowerCase()); } catch { /* ignore */ }
    const others = await prisma.libraryEntry.findMany({ where: { moduleId: doc.library, status: { not: "retired" } }, select: { entryKey: true, name: true } }).catch(() => []);
    for (const o of others) if (o.entryKey !== doc.key) names.add(o.name.toLowerCase());
    if (doc.name && names.has(doc.name.toLowerCase())) warnings.push(`name: "${doc.name}" already exists in this library — use a distinct name, or keep the same key to update your own entry`);
  } else {
    const l = doc as LotlEntryDoc;
    const verdict = classifyExclusion(l.attack_id, l.tactic, l.command);
    if (verdict.excluded) warnings.push(`command: ${verdict.reason} — this entry will be excluded from coverage sweeps`);
    const sourceId = l.library.slice(LOTL_PREFIX.length);
    if (l.library && !getRegistry().meta().some((m) => m.sourceId === sourceId)) errors.push(`library: unknown LOTL library "${sourceId}"`);
    if (!opts.admin) warnings.push("approval: LOTL entries carry a command — publishing is queued for admin approval");
  }
  return { ok: errors.length === 0, errors, warnings, doc, target, resolved, exists: !!prev, nextVersion: prev ? prev.version + 1 : 1 };
}

// ── Upsert / lifecycle ───────────────────────────────────────────────────────
export interface Actor { email: string; admin: boolean }

export class ForbiddenError extends Error {
  constructor(msg = "forbidden") { super(msg); this.name = "ForbiddenError"; }
}

/**
 * Authorization for changing an EXISTING entry (edit-over, status change, delete).
 * Entries are shared library content, so mutation is owner-or-admin, with the
 * higher-impact rows reserved to admins: LOTL entries (they carry a command that
 * becomes runnable) and anything currently published (live in a library).
 * A non-admin may therefore only create entries and manage their OWN unpublished,
 * non-LOTL ones; publishing a LOTL entry is always an admin decision.
 */
export function assertCanModify(row: { createdBy: string; kind: string; status: string }, actor: Actor, op: "edit" | "status" | "delete"): void {
  if (actor.admin) return;
  if (row.createdBy !== actor.email) throw new ForbiddenError("only the entry's author or an admin can change it");
  // Live (published) and moderated (retired) entries are admin-controlled: an author must
  // not be able to undo an admin's retirement by re-publishing, or alter a live entry.
  if (row.status === "published" || row.status === "retired") {
    throw new ForbiddenError(`a ${row.status} entry can only be changed by an admin`);
  }
  // Own draft / pending entries (including a pending LOTL submission) may be edited,
  // withdrawn or deleted by the author; publishing a LOTL entry stays admin-only (setStatus).
  void op;
}

export async function upsertEntry(raw: unknown, actor: Actor, publish: boolean): Promise<{ ok: boolean; entry?: EntryRow; validation: ValidationResult; forbidden?: string }> {
  const validation = await validateEntry(raw, { admin: actor.admin });
  const doc = validation.doc;
  if (publish && !validation.ok) return { ok: false, validation };
  if (!doc.library || !doc.key || !doc.name) return { ok: false, validation }; // nothing to key a draft on

  // LOTL entries (carry a command) need admin approval to go live.
  const status: EntryStatus = !publish ? "draft" : doc.kind === "lotl" && !actor.admin ? "pending" : "published";
  const prev = await prisma.libraryEntry.findUnique({ where: { moduleId_entryKey: { moduleId: doc.library, entryKey: doc.key } } });
  if (prev) {
    // Re-using an existing key overwrites that entry — only its author (while unpublished) or an admin may.
    try { assertCanModify(prev, actor, "edit"); } catch (e: any) { return { ok: false, validation, forbidden: String(e?.message || "forbidden") }; }
    // "Save draft" over a LIVE entry would silently pull it out of the library.
    if (prev.status === "published" && !publish) {
      return { ok: false, validation: { ...validation, ok: false, errors: [...validation.errors, "this entry is live — publish the update (creates a new version), or retire it first"] } };
    }
  }
  const history = prev ? (() => { try { return JSON.parse(prev.history || "[]"); } catch { return []; } })() : [];
  if (prev) { history.unshift({ version: prev.version, doc: JSON.parse(prev.doc), changelog: prev.changelog, at: prev.updatedAt, by: prev.publishedBy || prev.createdBy, replacedBy: actor.email }); history.length = Math.min(history.length, 20); }
  const data = {
    kind: doc.kind, moduleId: doc.library, entryKey: doc.key, name: doc.name, attackId: doc.attack_id,
    status, doc: JSON.stringify(doc), contentHash: hashDoc(doc), changelog: doc.changelog || "",
    ...(status === "published" ? { publishedBy: actor.email, publishedAt: new Date() } : {}),
  };
  const row = prev
    ? await prisma.libraryEntry.update({ where: { id: prev.id }, data: { ...data, version: prev.version + 1, history: JSON.stringify(history) } })
    : await prisma.libraryEntry.create({ data: { ...data, createdBy: actor.email } });
  await syncLotl(row);
  return { ok: true, entry: row as EntryRow, validation };
}

export async function setStatus(id: string, status: EntryStatus, actor: Actor): Promise<EntryRow | null> {
  const row = await prisma.libraryEntry.findUnique({ where: { id } });
  if (!row) return null;
  assertCanModify(row, actor, "status");
  if (status === "published") {
    const v = await validateEntry(JSON.parse(row.doc), { admin: actor.admin });
    if (!v.ok) throw new Error(`cannot publish: ${v.errors[0]}`);
    if (row.kind === "lotl" && !actor.admin) throw new Error("LOTL entries must be approved by an admin");
  }
  const upd = await prisma.libraryEntry.update({ where: { id }, data: { status, ...(status === "published" ? { publishedBy: actor.email, publishedAt: new Date() } : {}) } });
  await syncLotl(upd);
  return upd as EntryRow;
}

export async function deleteEntry(id: string, actor: Actor): Promise<boolean> {
  const row = await prisma.libraryEntry.findUnique({ where: { id } });
  if (!row) return false;
  assertCanModify(row, actor, "delete");
  await prisma.libraryEntry.delete({ where: { id } });
  await syncLotl({ ...row, status: "retired" });
  return true;
}

// ── LOTL materialisation (protected `custom:` rows) ──────────────────────────
async function syncLotl(row: { kind: string; moduleId: string; entryKey: string; status: string; doc: string; id: string; version: number }) {
  if (row.kind !== "lotl" || !row.moduleId.startsWith(LOTL_PREFIX)) return;
  const library = row.moduleId.slice(LOTL_PREFIX.length);
  const sourceRef = `custom:${row.entryKey}`;
  if (row.status !== "published") { await prisma.lotlTechnique.deleteMany({ where: { library, sourceRef } }); return; }
  const d = normalizeDoc(JSON.parse(row.doc)) as LotlEntryDoc;
  const data = {
    library, sourceRef, name: d.name, description: d.description, command: d.command, executor: d.executor,
    cleanupCommand: d.cleanup_command, techniqueId: d.attack_id, techniqueName: "", tactic: d.tactic, binaryPath: d.binary_path,
    elevationRequired: d.elevation_required, riskLevel: d.risk_level, platforms: JSON.stringify(d.platforms),
    metadata: JSON.stringify({ custom: true, entryId: row.id, version: row.version }), sourceUrl: d.source_url, contentHash: hashDoc(d),
  };
  await prisma.lotlTechnique.upsert({ where: { library_sourceRef: { library, sourceRef } }, create: data, update: data });
}

// ── Read-time merge ──────────────────────────────────────────────────────────
export async function publishedTechniqueEntries(moduleId?: string): Promise<Array<{ row: EntryRow; doc: TechniqueEntryDoc }>> {
  const rows = await prisma.libraryEntry.findMany({ where: { status: "published", kind: "technique", ...(moduleId ? { moduleId } : {}) }, orderBy: { publishedAt: "asc" } }).catch(() => []);
  const out: Array<{ row: EntryRow; doc: TechniqueEntryDoc }> = [];
  for (const r of rows) { const d = parseDoc(r); if (d && d.kind === "technique") out.push({ row: r as EntryRow, doc: d }); }
  return out;
}

/** Catalog items an entry contributes (one per linked ATT&CK id; coverage-only when no links). */
export function entryCatalogItems(doc: TechniqueEntryDoc): Array<{ id: string; name: string; tactic: string; uid: string; match: string[] | undefined }> {
  const uid = `entry:${doc.key}`;
  if (!doc.atomics.length) return [{ id: doc.attack_id, name: doc.name, tactic: doc.tactic, uid, match: [] }];
  const byTech = new Map<string, string[] | undefined>();
  for (const a of doc.atomics) {
    if (!a.technique) continue;
    if (!byTech.has(a.technique)) byTech.set(a.technique, a.name_includes?.length ? [...a.name_includes] : undefined);
    else {
      const cur = byTech.get(a.technique);
      if (cur === undefined || !a.name_includes?.length) byTech.set(a.technique, undefined);
      else byTech.set(a.technique, [...cur, ...a.name_includes]);
    }
  }
  return [...byTech].map(([tid, match], i) => ({ id: tid, name: doc.name, tactic: doc.tactic, uid: i === 0 ? uid : `${uid}#${tid}`, match }));
}

/** Return a copy of a module manifest with published entries merged into its catalog. */
export function mergeEntriesIntoManifest<M extends { contributes?: any }>(manifest: M, entries: TechniqueEntryDoc[]): M {
  if (!entries.length) return manifest;
  const clone: any = JSON.parse(JSON.stringify(manifest));
  clone.contributes = clone.contributes || {};
  const cat: any[] = (clone.contributes.catalog = clone.contributes.catalog || []);
  for (const e of entries) {
    let grp = cat.find((g) => String(g.name).toLowerCase() === e.group.toLowerCase() && String(g.domain || "").toLowerCase() === e.domain.toLowerCase());
    if (!grp) { grp = { name: e.group, domain: e.domain, description: "Analyst-added techniques", techniques: [] }; cat.push(grp); }
    for (const it of entryCatalogItems(e)) grp.techniques.push({ id: it.id, name: it.name, tactic: it.tactic, uid: it.uid, ...(it.match !== undefined ? { match: it.match } : {}) });
  }
  return clone;
}

export async function manifestWithEntries<M extends { contributes?: any }>(moduleId: string, manifest: M): Promise<M> {
  const es = await publishedTechniqueEntries(moduleId);
  return mergeEntriesIntoManifest(manifest, es.map((e) => e.doc));
}

/** Entry → TechniqueDef so attack-sim library cards + the simulate resolver need no changes. */
export function entryAtomics(doc: TechniqueEntryDoc): CuratedAtomic[] {
  return doc.atomics.filter((a) => a.technique).map((a) => ({ techniqueId: a.technique, ...(a.name_includes?.length ? { nameIncludes: a.name_includes } : {}), why: a.why || `Vetted local atomic test(s) for ${a.technique}.` }));
}
export function entryToTechnique(doc: TechniqueEntryDoc): TechniqueDef {
  const atomics = entryAtomics(doc);
  return {
    key: doc.key, name: doc.name, category: doc.domain || doc.group, variant: "Analyst-added",
    description: doc.description, attackTechniques: doc.attack_techniques.length ? doc.attack_techniques : [doc.attack_id],
    tactic: doc.tactic, platforms: doc.platforms, severity: doc.severity, summary: doc.summary,
    abuse: doc.abuse || "Added by an analyst — see the references for the source of this method.",
    labSetup: doc.lab_setup, chainNarrative: doc.chain_narrative, atomics, simulateNote: doc.simulate_note || undefined,
    runnableOnSar: atomics.length > 0 && doc.platforms.includes("windows"),
    detection: { summary: doc.detection.summary, dataSources: doc.detection.data_sources, queries: doc.detection.queries.map((q) => ({ format: q.format, title: q.title, query: q.query })) },
    mitigations: doc.mitigations.map((m) => ({ title: m.title, detail: m.detail, kind: m.kind, mitreId: m.mitre_id })),
    references: doc.references, origin: "analyst",
  };
}

// ── Export / import bundles ──────────────────────────────────────────────────
export interface Bundle { bundle: "detectops-library-entries"; schema: number; exportedAt: string; entries: EntryDoc[] }

export async function exportEntries(moduleId?: string, includeDrafts = false): Promise<Bundle> {
  const rows = await prisma.libraryEntry.findMany({ where: { ...(moduleId ? { moduleId } : {}), status: { in: includeDrafts ? ["published", "pending", "draft"] : ["published"] } }, orderBy: [{ moduleId: "asc" }, { entryKey: "asc" }] });
  const entries = rows.map(parseDoc).filter(Boolean) as EntryDoc[];
  return { bundle: "detectops-library-entries", schema: 1, exportedAt: new Date().toISOString(), entries };
}
