/**
 * POST /api/modules/validate — STATELESS dry-validate (no DB write) for the
 * builder playground's live feedback. Runs the manifest validator + the compiler
 * (which resolves atomic refIds against the AtomicTest catalogue + enforces
 * declared permissions) and returns errors/warnings without persisting anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { validateManifest } from "@/lib/modules/manifest-schema";
import { compileScenarios } from "@/lib/modules/compiler";
import { satisfies, isValid } from "@/lib/modules/semver";
import { CORE_VERSION } from "@/lib/modules/core-version";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, errors: ["invalid JSON"], warnings: [] }, { status: 400 });

  const v = validateManifest(body);
  const errors = [...v.errors];
  const warnings = [...v.warnings];

  let stepCount = 0;
  if (v.ok && v.manifest) {
    if (!isValid(v.manifest.version)) errors.push("version is not valid semver");
    if (!satisfies(CORE_VERSION, v.manifest.compatibleCoreVersion)) warnings.push(`core ${CORE_VERSION} does not satisfy compatibleCoreVersion ${v.manifest.compatibleCoreVersion}`);
    const compiled = await compileScenarios(v.manifest);
    errors.push(...compiled.errors);
    stepCount = compiled.scenarios.reduce((n, s) => n + s.steps.length, 0);
  }

  return NextResponse.json({ ok: errors.length === 0, errors, warnings, stepCount, coreVersion: CORE_VERSION });
}
