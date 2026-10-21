/**
 * GET  /api/modules            — list/search/filter installed simulation modules
 * POST /api/modules            — submit a module package (JSON), kick off validation
 *
 * A module is declarative content; submit validates the manifest, content-hashes
 * + signs the package, stores it, creates SimulationModule(status=submitted) +
 * ModuleVersion, and enqueues an async validation run.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-guard";
import { logEvent } from "@/lib/event-log";
import { isModuleFeatureEnabled } from "@/lib/modules/flags";
import { validateManifest, toPackage } from "@/lib/modules/manifest-schema";
import { moduleContentHash, signModule } from "@/lib/modules/signing";
import { savePackage, parsePackage } from "@/lib/modules/package-store";
import { enqueueValidationRun } from "@/lib/modules/validation/enqueue";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isModuleFeatureEnabled("marketplace")) return NextResponse.json({ items: [], marketplaceEnabled: false });

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").toLowerCase().trim();
  const category = sp.get("category") || "";
  const status = sp.get("status") || "";
  const mine = sp.get("mine") === "1";

  const where: any = {};
  if (category) where.category = category;
  if (status) where.status = status;
  if (mine) where.ownerId = auth.user.id;

  const rows = await prisma.simulationModule.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
  const items = rows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.moduleId.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
    .map((r) => ({
      id: r.id, moduleId: r.moduleId, name: r.name, version: r.version, category: r.category,
      description: r.description, author: r.author, icon: r.icon, status: r.status,
      signatureState: r.signatureState, enabled: r.enabled, ownerId: r.ownerId,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }));
  return NextResponse.json({ items, marketplaceEnabled: true });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!isModuleFeatureEnabled("marketplace")) return NextResponse.json({ error: "module marketplace disabled" }, { status: 403 });

  // Accept JSON body (v1 package format) — bare manifest or {manifest, scenarios}.
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });

  const v = validateManifest(body);
  if (!v.ok || !v.manifest) return NextResponse.json({ error: "manifest invalid", errors: v.errors }, { status: 400 });
  const manifest = v.manifest;

  const pkg = toPackage(body);
  const json = JSON.stringify(pkg);
  const contentHash = moduleContentHash(pkg);
  const signatureB64 = signModule(contentHash);

  let stored;
  try { stored = await savePackage(json); }
  catch (e: any) { return NextResponse.json({ error: e?.message || "package store failed" }, { status: 400 }); }

  // Reject a re-submit of an already-live module owned by someone else.
  const existing = await prisma.simulationModule.findUnique({ where: { moduleId: manifest.id } });
  if (existing && existing.ownerId && existing.ownerId !== auth.user.id && !(auth.enforced && auth.user.role === "admin")) {
    return NextResponse.json({ error: `module id ${manifest.id} is owned by another publisher` }, { status: 409 });
  }
  // Unowned rows are built-in/seeded modules: only an admin may overwrite them,
  // otherwise any user could re-submit a built-in id and take it over.
  if (existing && !existing.ownerId && auth.enforced && auth.user.role !== "admin") {
    return NextResponse.json({ error: `module id ${manifest.id} is a built-in module` }, { status: 409 });
  }

  const data = {
    moduleId: manifest.id, name: manifest.name, version: manifest.version, category: manifest.category,
    description: manifest.description, author: manifest.author, icon: manifest.icon || "",
    manifest: JSON.stringify(manifest), contentHash, status: "submitted",
    signatureState: "signed", signatureB64,
    permissions: JSON.stringify(manifest.permissions || {}),
    packageRef: stored.packageRef, ownerId: existing?.ownerId || auth.user.id,
  };
  const row = existing
    ? await prisma.simulationModule.update({ where: { moduleId: manifest.id }, data: { ...data, status: "submitted" } })
    : await prisma.simulationModule.create({ data });

  // Version history.
  await prisma.moduleVersion.upsert({
    where: { moduleRowId_version: { moduleRowId: row.id, version: manifest.version } },
    create: { moduleRowId: row.id, version: manifest.version, manifest: JSON.stringify(manifest), contentHash, packageRef: stored.packageRef, signatureB64, status: "draft" },
    update: { manifest: JSON.stringify(manifest), contentHash, packageRef: stored.packageRef, signatureB64 },
  });

  const enq = await enqueueValidationRun({ moduleRowId: row.id, version: manifest.version });

  void logEvent({
    category: "module" as any, action: "module.submit", actor: auth.user.email, status: "ok",
    targetType: "SimulationModule", targetId: row.id,
    message: `${manifest.id}@${manifest.version} submitted → validation queued`,
    details: { moduleId: manifest.id, version: manifest.version, validationRunId: enq.id },
  });

  return NextResponse.json({ ok: true, id: row.id, moduleId: manifest.id, version: manifest.version, status: "submitted", validationRunId: enq.id, contentHash });
}
