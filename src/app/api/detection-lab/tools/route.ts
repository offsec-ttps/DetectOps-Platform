/**
 * GET /api/detection-lab/tools
 * Returns available tools for lab deployment.
 *
 * POST /api/detection-lab/tools
 * Triggers tool installation on a running lab.
 * Body: { toolId: string, targetVM: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { TOOLS, getTool } from "@/config/lab-templates";

export async function GET() {
  return NextResponse.json({
    tools: TOOLS,
    categories: {
      "adversary-simulation": TOOLS.filter((t) => t.category === "adversary-simulation"),
      "red-team": TOOLS.filter((t) => t.category === "red-team"),
      "purple-team": TOOLS.filter((t) => t.category === "purple-team"),
      "utility": TOOLS.filter((t) => t.category === "utility"),
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { toolId, targetVM } = body;

  const tool = getTool(toolId);
  if (!tool) {
    return NextResponse.json({ error: `Tool '${toolId}' not found` }, { status: 404 });
  }

  // Build installation pipeline info
  const pipeline = {
    tool: tool.name,
    targetVM: targetVM || tool.targetVM,
    platforms: tool.platforms,
    requirements: tool.requirements,
    steps: tool.installSteps,
    status: "queued",
    message: `Installation of ${tool.name} queued for ${targetVM || tool.targetVM}`,
    environmentChecks: tool.platforms.includes("windows")
      ? [
          "Detect OS architecture (x64/x86)",
          "Check .NET Framework version",
          "Verify admin privileges",
          "Check Windows Defender exclusions",
        ]
      : [
          "Detect OS and package manager",
          "Check Python version",
          "Verify sudo access",
        ],
  };

  return NextResponse.json({ success: true, pipeline });
}
