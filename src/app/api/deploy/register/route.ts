/**
 * POST /api/deploy/register — register a freshly deployed lab into the
 * simulation pipeline (EnvironmentTarget + Splunk SIEM Integration).
 *
 * Body:
 *   { source: "local" | "cloud", templateId,
 *     // cloud:
 *     cloudProvider?, credentialId?, rangeId?, splunkHost?, splunkUser?, splunkPassword? }
 *
 * Local Splunk endpoint + creds are resolved from the template definition;
 * cloud passes the resolved Splunk endpoint when known.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser, ownsOr404 } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { ALL_TEMPLATES } from "@/config/lab-templates";
import { registerDeployedEnvironment } from "@/lib/deploy/register";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const source = body.source === "cloud" ? "cloud" : "local";
  const template = ALL_TEMPLATES.find((t) => t.id === String(body.templateId || ""));
  if (!template) return NextResponse.json({ error: `unknown templateId "${body.templateId}"` }, { status: 400 });

  // The EnvironmentTarget / Splunk Integration are upserted by a GLOBAL unique
  // name, so without this any user could take over (re-own + repoint) another
  // user's registered lab. Only the owner (or an admin) may re-register it.
  const existing = await prisma.environmentTarget.findUnique({ where: { name: template.name }, select: { ownerId: true } });
  if (existing) { const own = ownsOr404(auth, existing.ownerId); if (!own.ok) return own.response; }
  // A referenced cloud credential must belong to the caller.
  if (body.credentialId) {
    const cred = await prisma.cloudCredential.findUnique({ where: { id: String(body.credentialId) }, select: { ownerId: true } });
    if (!cred) return NextResponse.json({ error: "credential not found" }, { status: 404 });
    const own = ownsOr404(auth, cred.ownerId); if (!own.ok) return own.response;
  }
  // splunkHost is interpolated into the Integration apiUrl (https://<host>:8089).
  if (body.splunkHost !== undefined && body.splunkHost !== "" &&
      (typeof body.splunkHost !== "string" || !/^[A-Za-z0-9.-]{1,253}$/.test(body.splunkHost))) {
    return NextResponse.json({ error: "splunkHost must be a hostname or IPv4 address" }, { status: 400 });
  }

  try {
    const result = await registerDeployedEnvironment({
      source, ownerId: auth.user.id, template,
      cloudProvider: body.cloudProvider, credentialId: body.credentialId, rangeId: body.rangeId,
      splunkHost: body.splunkHost, splunkUser: body.splunkUser, splunkPassword: body.splunkPassword,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
