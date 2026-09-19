/**
 * GET /api/detection-lab/templates
 * Returns all lab templates with optional filtering.
 * Query params: mode=on-prem|cloud, labType=sar|sar-goad, provider=aws|gcp|azure
 */

import { NextRequest, NextResponse } from "next/server";
import { ALL_TEMPLATES, TOOLS, type DeploymentMode, type LabType, type CloudProvider } from "@/config/lab-templates";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") as DeploymentMode | null;
  const labType = searchParams.get("labType") as LabType | null;
  const provider = searchParams.get("provider") as CloudProvider | null;

  let templates = ALL_TEMPLATES;

  if (mode) templates = templates.filter((t) => t.mode === mode);
  if (labType) templates = templates.filter((t) => t.labType === labType);
  if (provider) templates = templates.filter((t) => t.cloudProvider === provider);

  return NextResponse.json({
    templates,
    tools: TOOLS,
    counts: {
      total: ALL_TEMPLATES.length,
      onPrem: ALL_TEMPLATES.filter((t) => t.mode === "on-prem").length,
      cloud: ALL_TEMPLATES.filter((t) => t.mode === "cloud").length,
    },
  });
}
