/**
 * GET /api/reports/git-config
 *
 * Tells the UI whether a GitHub integration is configured and which owner/repo a
 * report push would target — so the report panel can save locally first and push
 * "based on the git integration" without the user typing an owner each time.
 */

import { NextResponse } from "next/server";
import { getGitHubCredentials, getDefaultGitHubOwner } from "@/lib/github";

export async function GET() {
  const creds = await getGitHubCredentials();
  if (!creds) return NextResponse.json({ configured: false, owner: "", repo: "detection-reports" });
  const owner = await getDefaultGitHubOwner().catch(() => "");
  return NextResponse.json({ configured: true, owner, repo: "detection-reports" });
}
