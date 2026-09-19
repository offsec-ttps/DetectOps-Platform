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
import { requireUser } from "@/lib/auth-guard";
import { ALL_TEMPLATES } from "@/config/lab-templates";
import { registerDeployedEnvironment } from "@/lib/deploy/register";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const source = body.source === "cloud" ? "cloud" : "local";
  const template = ALL_TEMPLATES.find((t) => t.id === String(body.templateId || ""));
  if (!template) return NextResponse.json({ error: `unknown templateId "${body.templateId}"` }, { status: 400 });

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
