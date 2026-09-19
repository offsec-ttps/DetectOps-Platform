/**
 * Deterministic Sigma-YAML synthesizer.
 *
 * Given an enterprise use case, returns a canonical Sigma rule body. This is
 * the RECOMMENDED detection logic the UI shows side-by-side with the user's
 * ORIGINAL — never replacing it.
 *
 * Strategy:
 *   - If the original is already Sigma-shaped (has `title:` + `detection:`), we
 *     normalise it (ensure id, level, status, tags from techniques, condition).
 *   - Otherwise we build a Sigma skeleton from metadata:
 *       title:      use case name (≤ 120 chars)
 *       id:         deterministic uuid derived from the use case id (stable across regens)
 *       status:     experimental
 *       description: first paragraph of the use case description
 *       references:  blank (Phase 4 GitHub-push captures them)
 *       author:     owner ?? "DetectOps Enterprise Use Case Pipeline"
 *       tags:       attack.<tactic> + attack.<technique_id_lowercase>
 *       logsource:  inferred from platforms + extracted hints
 *       detection:
 *         selection: best-effort cue-based map from the original body
 *           (process Images, command-line keywords, URLs, IPs, tool names …)
 *         condition: selection
 *       falsepositives: ["Tune per environment"]
 *       level:      severity (info|low|medium|high|critical)
 *
 * It is deliberately deterministic + heuristic. The user reviews the result
 * side-by-side. Phase 2.x can swap in an LLM-driven synthesizer via the same
 * `synthesizeRecommended()` entrypoint.
 */

import { createHash } from "node:crypto";

export interface RecommendInput {
  useCaseId: string;
  name: string;
  description: string;
  originalDetectionLogic: string;
  format: string;                 // sigma | spl | kql | elastic-toml | yara | freeform | csv | md | txt | yaml
  severity: string;               // info | low | medium | high | critical
  platforms: string[];
  owner: string;
  mitreTechniques: string[];
  mitreTactics: string[];
}

export interface RecommendResult {
  body: string;
  isAlreadySigma: boolean;
  notes: string[];
}

const SIGMA_LEVEL_ENUM = new Set(["informational", "low", "medium", "high", "critical"]);

function indent(s: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return s.split("\n").map((l) => pad + l).join("\n");
}

function deterministicUuid(seed: string): string {
  // RFC-4122-shaped uuid derived from SHA256(seed). Stable across regens of the
  // same use case so the recommended Sigma keeps the same `id:` field.
  const hash = createHash("sha256").update(`enterprise-uc:${seed}`).digest("hex");
  // Conform to the v4 layout (8-4-4-4-12) with v4 + variant bits.
  const b = hash.slice(0, 32);
  const chars = b.split("");
  chars[12] = "4";
  // variant bits: high 2 bits = 10
  const variant = parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20, 32).join("")}`;
}

function looksLikeSigma(body: string): boolean {
  if (!body) return false;
  const hasTitle = /^title\s*:/im.test(body);
  const hasDetection = /^detection\s*:/im.test(body);
  return hasTitle && hasDetection;
}

function normaliseLevel(sev: string): string {
  const s = (sev || "").toLowerCase();
  if (s === "info") return "informational";
  if (SIGMA_LEVEL_ENUM.has(s)) return s;
  return "medium";
}

function inferLogsource(platforms: string[], format: string, body: string): { product?: string; category?: string; service?: string } {
  const lower = (body || "").toLowerCase();
  const p = platforms.map((x) => x.toLowerCase());

  // Product
  let product: string | undefined;
  if (p.includes("windows")) product = "windows";
  else if (p.includes("linux")) product = "linux";
  else if (p.includes("macos")) product = "macos";
  else if (p.includes("aws") || p.includes("iaas:aws")) product = "aws";
  else if (p.includes("azure") || p.includes("iaas:azure") || p.includes("azure-ad")) product = "azure";
  else if (p.includes("gcp") || p.includes("iaas:gcp")) product = "gcp";
  else if (p.includes("office-365")) product = "m365";

  // Category — look for canonical Sigma category keywords in the body
  let category: string | undefined;
  if (/\bprocess_creation\b|\bsysmon eid 1\b|\beid 1\b|\b4688\b/i.test(lower)) category = "process_creation";
  else if (/\bnetwork_connection\b|\bsysmon eid 3\b|\bnetflow\b|\bzeek conn\b/i.test(lower)) category = "network_connection";
  else if (/\bfile_event\b|\bfile_create\b|\bsysmon eid 11\b|\bsysmon eid 23\b/i.test(lower)) category = "file_event";
  else if (/\bregistry_event\b|\bsysmon eid 1[23]\b|\b4657\b/i.test(lower)) category = "registry_event";
  else if (/\bimage_load\b|\bsysmon eid 7\b/i.test(lower)) category = "image_load";
  else if (/\bcreate_remote_thread\b|\bsysmon eid 8\b/i.test(lower)) category = "create_remote_thread";
  else if (/\bdriver_load\b|\bsysmon eid 6\b/i.test(lower)) category = "driver_load";
  else if (/\bpipe_event\b/i.test(lower)) category = "pipe_event";
  else if (/\bproxy\b|\bwebserver\b|\baccess_combined\b|\bnginx\b/i.test(lower)) category = "webserver";

  // Service — for cloud product
  let service: string | undefined;
  if (product === "aws") service = "cloudtrail";
  else if (product === "azure") service = /signinlogs|sign-in/i.test(lower) ? "signinlogs" : /auditlogs/i.test(lower) ? "auditlogs" : undefined;
  else if (product === "m365") service = "audit";
  else if (product === "windows" && /signinlogs|sign-in/i.test(lower)) service = "security";

  return { product, category, service };
}

/**
 * Extract concrete IOC-like cues from the original body that can form a
 * conservative selection block. Returns a small object suitable for Sigma's
 * `detection.selection` YAML. Always returns at least a placeholder so the
 * rule has structure.
 */
function buildSelectionFromCues(body: string): { keyValues: Array<[string, string | string[]]>; notes: string[] } {
  const notes: string[] = [];
  const out: Array<[string, string | string[]]> = [];
  if (!body) {
    notes.push("Original body empty — selection is a placeholder; refine with concrete IOCs.");
    return {
      keyValues: [["CommandLine|contains", ["TODO_replace_with_concrete_indicator"]]],
      notes,
    };
  }

  // 1. Image cue (`*\foo.exe`)
  const imgs = new Set<string>();
  const imgRe = /([A-Za-z0-9_]+\.exe)\b/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(body)) !== null) {
    const name = m[1].toLowerCase();
    if (!["rundll32.exe", "cmd.exe", "powershell.exe", "wmic.exe"].includes(name) && name.length <= 32) {
      imgs.add(`\\\\${m[1]}`);
    }
  }
  // Process candidates that are common attacker LOLBINs OR explicit names
  const explicitImages = ["powershell.exe", "rundll32.exe", "regsvr32.exe", "mshta.exe", "wscript.exe", "cscript.exe", "certutil.exe", "msbuild.exe", "installutil.exe", "reg.exe", "schtasks.exe", "bitsadmin.exe", "sc.exe", "wmic.exe", "winrm.exe", "psexec.exe"];
  for (const e of explicitImages) {
    if (new RegExp("\\b" + e + "\\b", "i").test(body)) imgs.add(`\\\\${e}`);
  }
  if (imgs.size > 0) {
    out.push(["Image|endswith", [...imgs].slice(0, 8)]);
  }

  // 2. Command-line cues — quoted strings + suspicious keywords
  const cmdKeywords = new Set<string>();
  const kwList = [
    "comsvcs.dll", "MiniDump", "MiniDumpWriteDump", "-enc", "-EncodedCommand", "FromBase64String",
    "Invoke-Expression", "IEX", "downloadstring", "Net.WebClient", "bypass",
    "Get-LocalGroupMember", "Add-MpPreference", "Set-MpPreference",
    "schtasks", "vssadmin", "ntdsutil", "wbadmin", "reg save", "lsass",
    "/etc/passwd", "/etc/shadow", "/dev/shm", "wget ", "curl ",
    "/c4uxxxxx", "BlackByte", "LockBit", "Conti", "Mimikatz",
    "uri/jndi", "${jndi:", "log4j", "BeEF",
  ];
  for (const kw of kwList) {
    if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(body)) {
      cmdKeywords.add(kw);
    }
  }
  // YAML quoted-string cues: `'comsvcs.dll'` or `"MiniDump"`
  const quoteRe = /['"`]([^'"`\n]{3,80})['"`]/g;
  let q: RegExpExecArray | null;
  let extraQuoted = 0;
  while ((q = quoteRe.exec(body)) !== null && extraQuoted < 6) {
    const v = q[1].trim();
    if (/^[A-Za-z0-9_\-./\\: ]+$/.test(v) && !cmdKeywords.has(v) && v.length >= 4) {
      cmdKeywords.add(v);
      extraQuoted++;
    }
  }
  if (cmdKeywords.size > 0) {
    out.push(["CommandLine|contains", [...cmdKeywords].slice(0, 12)]);
  }

  // 3. Domain / URL cues
  const urls = new Set<string>();
  const urlRe = /\bhttps?:\/\/[^\s<>'"]+/gi;
  let u: RegExpExecArray | null;
  while ((u = urlRe.exec(body)) !== null && urls.size < 5) {
    urls.add(u[0].slice(0, 80));
  }
  if (urls.size > 0) {
    out.push(["DestinationHostname|contains", [...urls]]);
  }

  // 4. IPv4
  const ips = new Set<string>();
  const ipRe = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  let ip: RegExpExecArray | null;
  while ((ip = ipRe.exec(body)) !== null && ips.size < 5) {
    const v = ip[0];
    // Skip obvious version-string false positives
    if (!/^0\.0\.0\.0$/.test(v) && !/^1\.0\.0\.0$/.test(v)) ips.add(v);
  }
  if (ips.size > 0) {
    out.push(["DestinationIp", [...ips]]);
  }

  if (out.length === 0) {
    notes.push("No concrete IOCs extracted from the original — selection is a structural placeholder.");
    out.push(["CommandLine|contains", ["TODO_replace_with_concrete_indicator"]]);
  }

  return { keyValues: out, notes };
}

function renderYamlValue(v: string | string[], indentSpaces = 4): string {
  if (Array.isArray(v)) {
    if (v.length === 1) return JSON.stringify(v[0]);
    return "\n" + v.map((x) => " ".repeat(indentSpaces) + "- " + JSON.stringify(x)).join("\n");
  }
  return JSON.stringify(v);
}

function yamlSafeMultiline(s: string, indentSpaces = 2): string {
  // Multi-line strings use the block-scalar `|` style. Lines indented by indentSpaces.
  const lines = (s || "").replace(/\r\n/g, "\n").split("\n");
  if (lines.length === 1 && !lines[0].includes(":") && !lines[0].includes("\"") && !lines[0].includes("'")) {
    return JSON.stringify(lines[0]);
  }
  const pad = " ".repeat(indentSpaces);
  return "|\n" + lines.map((l) => pad + l).join("\n");
}

export function synthesizeRecommended(input: RecommendInput): RecommendResult {
  const notes: string[] = [];
  const isSigma = looksLikeSigma(input.originalDetectionLogic);

  if (isSigma) {
    // Normalisation pass — make sure id / status / level / tags are present.
    // We do a non-destructive append: missing fields get prepended; existing fields untouched.
    let body = input.originalDetectionLogic.trim();
    if (!/^id\s*:/im.test(body)) body = `id: ${deterministicUuid(input.useCaseId)}\n` + body;
    if (!/^status\s*:/im.test(body)) body = body.replace(/^(title\s*:.+\n)/im, `$1status: experimental\n`);
    if (!/^level\s*:/im.test(body)) body += `\nlevel: ${normaliseLevel(input.severity)}`;
    // Tag attack.tNNNN.nnn if not present
    const tags = input.mitreTechniques.map((t) => `attack.${t.toLowerCase()}`);
    for (const tag of tags) {
      if (!body.includes(tag)) {
        if (/^tags\s*:/im.test(body)) {
          body = body.replace(/^(tags\s*:\s*\n)/im, `$1  - ${tag}\n`);
        } else {
          body += `\ntags:\n  - ${tag}`;
        }
      }
    }
    notes.push("Original is already Sigma-shaped — normalised id/status/level/tags only.");
    return { body, isAlreadySigma: true, notes };
  }

  // Synthesize a fresh Sigma skeleton
  const ls = inferLogsource(input.platforms, input.format, [input.originalDetectionLogic, input.description].join(" "));
  const selection = buildSelectionFromCues(input.originalDetectionLogic);
  notes.push(...selection.notes);

  const title = (input.name || "Enterprise Use Case").slice(0, 120);
  const description = (input.description || `Synthesised from ${input.format || "freeform"} source.`).split(/\n\s*\n/)[0].slice(0, 500);
  const author = input.owner || "DetectOps Enterprise Use Case Pipeline";

  const tags: string[] = [
    ...input.mitreTactics.map((t) => `attack.${t.toLowerCase().replace(/\s+/g, "_")}`),
    ...input.mitreTechniques.map((t) => `attack.${t.toLowerCase()}`),
  ];

  // Build YAML manually so output stays diff-friendly and reviewer-readable.
  const lines: string[] = [];
  lines.push(`title: ${JSON.stringify(title)}`);
  lines.push(`id: ${deterministicUuid(input.useCaseId)}`);
  lines.push(`status: experimental`);
  lines.push(`description: ${yamlSafeMultiline(description, 2)}`);
  lines.push(`references: []`);
  lines.push(`author: ${JSON.stringify(author)}`);
  lines.push(`date: 2026/06/06`);
  if (tags.length > 0) {
    lines.push(`tags:`);
    for (const t of tags) lines.push(`  - ${t}`);
  }
  lines.push(`logsource:`);
  if (ls.product) lines.push(`  product: ${ls.product}`);
  if (ls.category) lines.push(`  category: ${ls.category}`);
  if (ls.service) lines.push(`  service: ${ls.service}`);
  if (!ls.product && !ls.category && !ls.service) {
    lines.push(`  # TODO: declare product/category/service explicit to your environment`);
  }
  lines.push(`detection:`);
  lines.push(`  selection:`);
  for (const [k, v] of selection.keyValues) {
    if (Array.isArray(v)) {
      lines.push(`    ${k}:`);
      for (const x of v) lines.push(`      - ${JSON.stringify(x)}`);
    } else {
      lines.push(`    ${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push(`  condition: selection`);
  lines.push(`falsepositives:`);
  lines.push(`  - Tune per environment`);
  lines.push(`level: ${normaliseLevel(input.severity)}`);

  return {
    body: lines.join("\n"),
    isAlreadySigma: false,
    notes,
  };
}
