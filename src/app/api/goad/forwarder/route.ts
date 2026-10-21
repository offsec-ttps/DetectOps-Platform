/**
 * POST /api/goad/forwarder
 *
 * Install Splunk Universal Forwarder extension on GOAD Windows machines.
 * Runs the Ansible playbook from the splunk_forwarder extension.
 *
 * Body: { splunkIp?: string, splunkPort?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { requireRole } from "@/lib/auth-guard";

const exec = promisify(execFile);

const GOAD_PATH = process.env.GOAD_PATH || "/media/nested/SamsungEvo/Projects/GOAD/GOAD";
const GOAD_INSTANCE_ID = process.env.GOAD_INSTANCE_ID || "d86a4c-minilab-virtualbox";
const DEFAULT_SPLUNK_IP = process.env.SPLUNK_IP || "10.0.1.12";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const PORT = /^\d{1,5}$/;
// No whitespace (k=v splitting), no Jinja/template metachars ({ } %), no quotes.
const SAFE_SECRET = /^[A-Za-z0-9!@^*()_+\-=.,:;?~\[\]]{1,128}$/;

export async function POST(req: NextRequest) {
  // Runs ansible-playbook from the server against the GOAD hosts.
  const auth = await requireRole("admin");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const splunkIp = String(body.splunkIp || DEFAULT_SPLUNK_IP);
  const splunkPort = String(body.splunkPort || "9997");
  const splunkMgmtPort = String(body.splunkMgmtPort || "8089");
  const splunkPassword = String(body.splunkPassword || "I-l1ke-Attack-Range!");
  // SECURITY: these become ansible --extra-vars. Free text there allows extra
  // variable injection (ansible_connection=local …) and Jinja `{{ lookup('pipe',…) }}`
  // execution on this host — so validate strictly and pass as JSON.
  if (!IPV4.test(splunkIp) || !PORT.test(splunkPort) || !PORT.test(splunkMgmtPort) || !SAFE_SECRET.test(splunkPassword)) {
    return NextResponse.json(
      { success: false, error: "splunkIp must be IPv4, ports numeric, splunkPassword 1-128 chars without spaces/quotes/{}%" },
      { status: 400 }
    );
  }

  const instanceDir = `${GOAD_PATH}/workspace/${GOAD_INSTANCE_ID}`;
  const inventory = `${instanceDir}/inventory_disable_vagrant`;
  const extensionPlaybook = `${GOAD_PATH}/extensions/splunk_forwarder/ansible/install.yml`;

  // Validate prerequisites
  if (!existsSync(inventory)) {
    return NextResponse.json(
      { success: false, error: "GOAD inventory not found. Is the instance deployed?" },
      { status: 400 }
    );
  }

  if (!existsSync(extensionPlaybook)) {
    return NextResponse.json(
      { success: false, error: "Splunk forwarder extension not found in GOAD" },
      { status: 400 }
    );
  }

  // Build merged inventory with extension groups
  const mergedInvPath = `${instanceDir}/inventory_splunk_forwarder_tmp`;
  try {
    const invContent = await readFile(inventory, "utf-8");
    const merged = invContent + "\n; Splunk Forwarder Extension groups\n[splunk_forwarder_targets]\ndc01\n\n[wef_sources]\nws01\n\n[sysmon_targets]\ndc01\nws01\n";
    await writeFile(mergedInvPath, merged);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to create merged inventory: ${err.message}` },
      { status: 500 }
    );
  }

  // Run ansible-playbook (use GOAD's venv which has working dependencies)
  const goadAnsible = `${process.env.HOME}/.goad/.venv/bin/ansible-playbook`;
  const ansibleBin = require("fs").existsSync(goadAnsible) ? goadAnsible : "ansible-playbook";

  try {
    const { stdout, stderr } = await exec(
      ansibleBin,
      [
        "-i", mergedInvPath,
        extensionPlaybook,
        "--extra-vars",
        JSON.stringify({
          splunk_server_ip: splunkIp,
          splunk_server_port: splunkPort,
          splunk_server_mgmt_port: splunkMgmtPort,
          splunk_uf_password: splunkPassword,
          sysmon_download_url: "https://download.sysinternals.com/files/Sysmon.zip",
        }),
        "-v",
      ],
      {
        timeout: 600000, // 10 minutes
        env: { ...process.env, ANSIBLE_HOST_KEY_CHECKING: "False" },
        cwd: `${GOAD_PATH}/extensions/splunk_forwarder/ansible`,
      }
    );

    // Update instance.json to record extension installation
    const instanceFile = `${instanceDir}/instance.json`;
    try {
      const raw = await readFile(instanceFile, "utf-8");
      const data = JSON.parse(raw);
      if (!data.extensions) data.extensions = [];
      if (!data.extensions.includes("splunk_forwarder")) {
        data.extensions.push("splunk_forwarder");
        await writeFile(instanceFile, JSON.stringify(data, null, 4));
      }
    } catch { /* non-critical */ }

    // Cleanup
    await unlink(mergedInvPath).catch(() => {});

    return NextResponse.json({
      success: true,
      splunkIp,
      splunkPort,
      message: "Splunk Universal Forwarder installed on all GOAD Windows machines",
      stdout: stdout.slice(-3000),
      stderr: stderr.slice(-1000),
    });
  } catch (err: any) {
    await unlink(mergedInvPath).catch(() => {});

    return NextResponse.json(
      {
        success: false,
        error: "Ansible playbook failed",
        details: err.message,
        stdout: err.stdout?.slice(-3000) || "",
        stderr: err.stderr?.slice(-2000) || "",
      },
      { status: 500 }
    );
  }
}
