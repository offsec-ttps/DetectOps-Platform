/**
 * POST /api/detection-lab/cloud/custom-template
 *
 * Write a custom SAR template YAML into the deployed SAR repo's templates
 * directory so SAR's web UI picks it up on the next `/templates` GET.
 *
 * Host path: {sarDeployPath}/attack_range/templates/{provider}/{name}.yml
 *   e.g. /media/nested/SamsungEvo/detection-labs/sar-onprem-docker/attack_range/templates/aws/my_custom_aws.yml
 *
 * The Next.js dev server runs as the `nested` user which has write access to
 * that directory on the host. The SAR API container mounts the same directory
 * (read-only) and re-reads on every /templates call, so no restart is needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";
import yaml from "js-yaml";

// ── Role allowlist (keep this list conservative) ──
// Sourced from grepping upstream templates + docs.
const ALLOWED_ROLES = new Set([
  "P4T12ICK.ludus_ar_splunk",
  "P4T12ICK.ludus_ar_windows",
  "P4T12ICK.ludus_ar_linux",
  "P4T12ICK.ar_kali",
  "P4T12ICK.ar_guacamole",
  "P4T12ICK.ar_zeek",
  "P4T12ICK.ar_soar",
]);

const PROVIDERS = new Set(["aws", "azure", "gcp"] as const);
const NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;

interface ServerInput {
  name: string;
  os: "linux" | "windows";
  instance_type?: string;
  ip_last_octet: number;
  roles: string[];
}

interface Body {
  provider: "aws" | "azure" | "gcp";
  name: string;
  description?: string;
  password: string;
  ip_whitelist: string;
  region?: string;
  /** Azure-only */
  location?: string;
  /** GCP-only */
  zone?: string;
  project_id?: string;
  subscription_id?: string;
  servers: ServerInput[];
  overwrite?: boolean;
}

function findSarDeployPath(): string | null {
  try {
    const reg = path.join(process.cwd(), "labs", ".deployments-registry.json");
    if (!existsSync(reg)) return null;
    const entries: any[] = JSON.parse(readFileSync(reg, "utf-8"));
    const sar = entries.find((e) => e.templateId === "sar-onprem-docker");
    return sar?.deployPath || null;
  } catch {
    return null;
  }
}

// AMI / image defaults per (provider, os).
function serverProviderFields(provider: "aws" | "azure" | "gcp", os: "linux" | "windows"): Record<string, unknown> {
  if (provider === "aws") {
    if (os === "linux") return {
      ami_name_filter: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
      ami_owner: "099720109477",
      linux: true,
      user_name: "ubuntu",
    };
    return {
      ami_name_filter: "Windows_Server-2022-English-Full-Base-*",
      ami_owner: "801119661308",
      windows: true,
      user_name: "Administrator",
    };
  }
  if (provider === "azure") {
    if (os === "linux") return {
      image_publisher: "canonical",
      image_offer: "0001-com-ubuntu-server-jammy",
      image_sku: "22_04-lts",
      linux: true,
      user_name: "ubuntu",
    };
    return {
      image_publisher: "MicrosoftWindowsServer",
      image_offer: "WindowsServer",
      image_sku: "2022-datacenter",
      windows: true,
      user_name: "Administrator",
    };
  }
  // gcp
  if (os === "linux") return {
    image_family: "ubuntu-2204-lts",
    image_project: "ubuntu-os-cloud",
    linux: true,
    user_name: "ubuntu",
  };
  return {
    image_family: "windows-2022",
    image_project: "windows-cloud",
    windows: true,
    user_name: "Administrator",
  };
}

function defaultInstanceType(provider: "aws" | "azure" | "gcp", os: "linux" | "windows"): string {
  if (provider === "aws")   return os === "windows" ? "t3.large" : "t3.xlarge";
  if (provider === "azure") return "Standard_D4s_v3";
  return "e2-standard-4"; // gcp
}

function cloudBlock(body: Body): Record<string, unknown> {
  if (body.provider === "aws") {
    return { region: body.region || "eu-central-1", aws_default_tags: { splunkit_environment_type: "non-prd" } };
  }
  if (body.provider === "azure") {
    return { location: body.location || "West Europe", subscription_id: body.subscription_id || "xxx" };
  }
  return { project_id: body.project_id || "xxx", region: body.region || "europe-west3", zone: body.zone || "europe-west3-b" };
}

function roleBlock(roleId: string, password: string): Record<string, unknown> {
  // Map role → its canonical "password" var name when applicable.
  const vars: Record<string, unknown> = {};
  if (roleId === "P4T12ICK.ludus_ar_splunk") vars.ludus_ar_splunk_password = password;
  if (roleId === "P4T12ICK.ludus_ar_windows") { vars.ludus_ar_windows_password = password; vars.ludus_ar_windows_splunk_ip = "10.0.2.10"; }
  if (roleId === "P4T12ICK.ar_guacamole") vars.ar_guacamole_password = password;
  return { role: roleId, vars };
}

function composeYaml(body: Body): string {
  const doc: Record<string, unknown> = {
    general: {
      attack_range_password: body.password,
      cloud_provider: body.provider,
      attack_range_name: "ar",
      ip_whitelist: body.ip_whitelist,
      description: body.description || `Custom ${body.provider.toUpperCase()} deployment`,
    },
    [body.provider]: cloudBlock(body),
    attack_range: body.servers.map((s) => ({
      name: s.name,
      ...serverProviderFields(body.provider, s.os),
      instance_type: s.instance_type || defaultInstanceType(body.provider, s.os),
      ip_last_octet: s.ip_last_octet,
      roles: s.roles.map((r) => roleBlock(r, body.password)),
    })),
  };
  return yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false });
}

function validate(body: unknown): { ok: true; body: Body } | { ok: false; error: string } {
  const b = body as Body;
  if (!b || typeof b !== "object") return { ok: false, error: "body required" };
  if (!PROVIDERS.has(b.provider)) return { ok: false, error: `provider must be one of ${[...PROVIDERS].join("|")}` };
  if (typeof b.name !== "string" || !NAME_RE.test(b.name)) {
    return { ok: false, error: "name must be 3-41 chars, lowercase letters/digits/underscore, starting with a letter" };
  }
  if (typeof b.password !== "string" || b.password.length < 6) return { ok: false, error: "password must be at least 6 chars" };
  if (typeof b.ip_whitelist !== "string" || !/^[\d./]+$/.test(b.ip_whitelist)) {
    return { ok: false, error: "ip_whitelist must be a CIDR (digits, dots, and slash only)" };
  }
  if (!Array.isArray(b.servers) || b.servers.length === 0) return { ok: false, error: "at least one server required" };
  for (const s of b.servers) {
    if (typeof s.name !== "string" || !/^[a-z][a-z0-9_]{1,20}$/.test(s.name)) return { ok: false, error: `server.name invalid: ${s.name}` };
    if (s.os !== "linux" && s.os !== "windows") return { ok: false, error: `server.os must be linux|windows (got ${s.os})` };
    if (!Number.isInteger(s.ip_last_octet) || s.ip_last_octet < 10 || s.ip_last_octet > 50) {
      return { ok: false, error: `server.ip_last_octet must be 10-50 (got ${s.ip_last_octet})` };
    }
    if (!Array.isArray(s.roles) || s.roles.length === 0) return { ok: false, error: `server ${s.name} needs at least one role` };
    for (const r of s.roles) {
      if (!ALLOWED_ROLES.has(r)) return { ok: false, error: `role not allowed: ${r}` };
    }
  }
  return { ok: true, body: b };
}

export async function POST(req: NextRequest) {
  let parsed: unknown;
  try { parsed = await req.json(); }
  catch { return NextResponse.json({ status: "error", message: "invalid JSON body" }, { status: 400 }); }

  const v = validate(parsed);
  if (!v.ok) return NextResponse.json({ status: "error", message: v.error }, { status: 400 });
  const body = v.body;

  const sarRoot = findSarDeployPath();
  if (!sarRoot) {
    return NextResponse.json({
      status: "error",
      message: "SAR + Onprem Docker template is not deployed. Deploy it from the On-Premises tab first.",
    }, { status: 400 });
  }

  // Resolve final path and enforce no traversal via extra realpath-style check
  const targetDir = path.join(sarRoot, "attack_range", "templates", body.provider);
  const fileName = `${body.name}.yml`;
  const targetPath = path.join(targetDir, fileName);
  if (!targetPath.startsWith(path.resolve(targetDir) + path.sep)) {
    return NextResponse.json({ status: "error", message: "path traversal rejected" }, { status: 400 });
  }

  if (existsSync(targetPath) && !body.overwrite) {
    return NextResponse.json({
      status: "error",
      message: `Template ${fileName} already exists — pass overwrite: true to replace.`,
    }, { status: 409 });
  }

  let yamlBody: string;
  try { yamlBody = composeYaml(body); }
  catch (e: any) { return NextResponse.json({ status: "error", message: `yaml compose failed: ${e?.message}` }, { status: 500 }); }

  try { writeFileSync(targetPath, yamlBody, { encoding: "utf-8" }); }
  catch (e: any) { return NextResponse.json({ status: "error", message: `write failed: ${e?.message}` }, { status: 500 }); }

  return NextResponse.json({
    status: "ok",
    message: "Template created. Refresh the Cloud tab or SAR UI to see it.",
    provider: body.provider,
    name: fileName,
    path: targetPath,
  });
}

/** Expose known-good roles so the form can show a multi-select. */
export async function GET() {
  return NextResponse.json({
    allowed_roles: [...ALLOWED_ROLES],
    name_pattern: NAME_RE.source,
    providers: [...PROVIDERS],
  });
}
