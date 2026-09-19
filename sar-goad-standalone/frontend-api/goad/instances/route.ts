/**
 * GET /api/goad/instances
 *
 * List all GOAD instances in the workspace directory.
 */

import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";

const GOAD_PATH = process.env.GOAD_PATH || "/media/nested/SamsungEvo/Projects/GOAD/GOAD";

export async function GET() {
  const workspacePath = `${GOAD_PATH}/workspace`;

  if (!existsSync(workspacePath)) {
    return NextResponse.json({ instances: [], error: "Workspace directory not found" });
  }

  const entries = await readdir(workspacePath, { withFileTypes: true });
  const instances = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const instanceFile = `${workspacePath}/${entry.name}/instance.json`;
    if (!existsSync(instanceFile)) continue;

    try {
      const raw = await readFile(instanceFile, "utf-8");
      const data = JSON.parse(raw);
      instances.push({
        id: data.id,
        lab: data.lab,
        provider: data.provider,
        provisioner: data.provisioner,
        ipRange: data.ip_range,
        status: data.status,
        extensions: data.extensions || [],
        isDefault: data.is_default || false,
      });
    } catch { /* skip malformed */ }
  }

  return NextResponse.json({
    goadPath: GOAD_PATH,
    instances,
    availableLabs: ["MINILAB", "GOAD", "GOAD-Light", "GOAD-Mini", "NHA", "SCCM"],
    availableExtensions: existsSync(`${GOAD_PATH}/extensions/splunk_forwarder`)
      ? ["elk", "wazuh", "splunk_forwarder", "exchange", "guacamole"]
      : ["elk", "wazuh", "exchange", "guacamole"],
  });
}
