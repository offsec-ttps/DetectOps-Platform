/**
 * GET /api/detection-lab/config
 * Reads and parses attack_range_local.conf, returns structured sections.
 *
 * PUT /api/detection-lab/config
 * Saves edited config back to file.
 * Body: { raw: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, copyFile } from "fs/promises";
import { existsSync } from "fs";

const SAR_PATH = process.env.SAR_PATH || "/media/nested/SamsungEvo/Simulation/attack_range_local";
const CONF_PATH = `${SAR_PATH}/attack_range_local.conf`;

interface ConfigSection {
  name: string;
  entries: { key: string; value: string; comment: string }[];
}

function parseConf(raw: string): { sections: ConfigSection[]; flat: Record<string, string> } {
  const sections: ConfigSection[] = [];
  const flat: Record<string, string> = {};
  let current: ConfigSection = { name: "global", entries: [] };
  let pendingComment = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) { pendingComment = ""; continue; }
    if (trimmed.startsWith("#")) {
      pendingComment = trimmed.replace(/^#+\s*/, "");
      continue;
    }
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      if (current.entries.length > 0 || current.name !== "global") sections.push(current);
      current = { name: sectionMatch[1], entries: [] };
      pendingComment = "";
      continue;
    }
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();
      current.entries.push({ key, value, comment: pendingComment });
      flat[`${current.name}.${key}`] = value;
      pendingComment = "";
    }
  }
  if (current.entries.length > 0) sections.push(current);

  return { sections, flat };
}

export async function GET() {
  if (!existsSync(CONF_PATH)) {
    return NextResponse.json({
      error: "attack_range_local.conf not found",
      path: CONF_PATH,
      exists: false,
    }, { status: 404 });
  }

  try {
    const raw = await readFile(CONF_PATH, "utf-8");
    const { sections, flat } = parseConf(raw);

    // Extract key deployment parameters
    const summary = {
      splunkIp: flat["splunk_server.splunk_server_private_ip"] || "10.0.1.12",
      splunkPassword: flat["splunk_settings.splunk_admin_password"] || "",
      splunkVersion: flat["splunk_settings.splunk_url"]?.match(/releases\/([\d.]+)\//)?.[1] || "?",
      dcIp: flat["windows_domain_controller.windows_domain_controller_private_ip"] || "10.0.1.14",
      winPassword: flat["windows_settings.win_password"] || "",
      sysmonTemplate: flat["windows_settings.win_sysmon_template"] || "",
      artTechnique: flat["simulation.art_run_techniques"] || "",
      enabledMachines: {
        splunk_server: flat["environment.splunk_server"] === "1",
        phantom_server: flat["environment.phantom_server"] === "1",
        windows_domain_controller: flat["environment.windows_domain_controller"] === "1",
        windows_server: flat["environment.windows_server"] === "1",
        kali_machine: flat["environment.kali_machine"] === "1",
        windows_client: flat["environment.windows_client"] === "1",
      },
    };

    return NextResponse.json({
      exists: true,
      path: CONF_PATH,
      raw,
      sections,
      flat,
      summary,
      sectionNames: sections.map((s) => s.name),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { raw } = body;

  if (!raw || typeof raw !== "string") {
    return NextResponse.json({ error: "raw config string is required" }, { status: 400 });
  }

  try {
    // Backup existing config
    if (existsSync(CONF_PATH)) {
      await copyFile(CONF_PATH, `${CONF_PATH}.bak`);
    }
    await writeFile(CONF_PATH, raw, "utf-8");
    return NextResponse.json({ success: true, message: "Configuration saved", backupPath: `${CONF_PATH}.bak` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
