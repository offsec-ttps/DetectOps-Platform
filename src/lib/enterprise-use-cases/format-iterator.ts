/**
 * Polyglot row iterator for Enterprise Use Case uploads.
 *
 * Accepts a file buffer + filename + sniffed/declared format and yields one
 * `ParsedRow` per logical use case in the upload.
 *
 *   xlsx        → 1 row per non-empty worksheet row (header row → field map)
 *   csv         → 1 row per non-empty data line (RFC-4180-lite parser)
 *   md          → 1 row per H1/H2 section; the first fenced code block in
 *                  the section becomes detection logic
 *   txt         → 1 row per blank-line-separated block; key:value pairs
 *                  per line + free-form body after blank line
 *   sigma|spl|kql|yaml|toml|yara  → single-row passthrough (one rule = one UC)
 *
 * Column-name heuristics (case-insensitive, hyphen/underscore-insensitive):
 *
 *   name             ← name | title | use_case | usecase | rule_name
 *   description      ← description | desc | summary | abstract | rationale
 *   detectionLogic   ← detection | logic | query | rule | rule_body | spl | kql | sigma | search
 *   severity         ← severity | level | priority
 *   owner            ← owner | author | team | contact
 *   platforms        ← platform | platforms | os | os_platform
 *   mitreTechniques  ← mitre | techniques | technique | attack | attack_id | t_id
 *   tactics          ← tactic | tactics
 *   dataSources      ← data_source | datasource | data_sources | logsource
 */

import * as XLSX from "xlsx";

export type EnterpriseUploadFormat =
  | "xlsx" | "csv" | "md" | "txt"
  | "sigma" | "spl" | "kql" | "yaml" | "toml" | "yara"
  | "unknown";

export interface ParsedRow {
  name: string;
  description: string;
  detectionLogic: string;
  severity: string;                            // raw user value; normalised later
  owner: string;
  platforms: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  dataSources: string[];
  sourceRowRef: string;                        // "Row 7" | "Sheet1!A8" | "Section: T1003.001" | "Block 3"
}

export interface IteratorResult {
  format: EnterpriseUploadFormat;
  rows: ParsedRow[];
  errors: Array<{ row: string; message: string }>;
}

const COLUMN_ALIASES: Record<keyof ParsedRow, string[]> = {
  name: [
    // Direct
    "name", "title", "rule_title", "rule_name", "detection_name", "detection_title",
    "scenario_name", "alert_name", "analytic_name", "story_name", "search_name",
    // Use-case variants
    "usecase", "use_case", "use_case_name", "usecase_name", "case_name", "case_title",
  ],
  description: [
    "description", "desc", "summary", "abstract", "rationale", "notes",
    "purpose", "intent", "details", "explanation",
    "rule_description", "detection_description",
  ],
  detectionLogic: [
    // Direct
    "detection", "detection_logic", "logic", "query", "rule", "rule_body", "search",
    "expression", "rule_code", "rule_definition", "logic_code",
    // Per-language
    "spl", "splunk_query", "splunk_search", "splunk_spl",
    "kql", "kql_query", "kusto_query", "sentinel_kql", "defender_kql",
    "sigma", "sigma_rule", "sigma_yaml",
    "lucene", "eql", "esql", "elasticsearch_query",
    "yara", "yara_rule", "yara_l", "yara-l",
    "panther_python", "panther",
  ],
  severity: [
    "severity", "level", "priority", "risk", "rule_severity",
    "alert_severity", "criticality", "risk_score",
  ],
  owner: [
    "owner", "author", "team", "contact", "engineer",
    "rule_author", "detection_owner", "responsible_team",
    "created_by", "authored_by", "maintainer", "assignee",
  ],
  platforms: [
    "platform", "platforms", "os", "os_platform", "target", "targets",
    "applicable_platforms", "system", "operating_system",
  ],
  mitreTechniques: [
    "mitre", "techniques", "technique", "attack", "attack_id", "tid", "t_id",
    "mitre_technique", "mitre_techniques", "mitre_id", "mitre_ids",
    "attack_technique", "attack_techniques", "attck", "att&ck",
  ],
  mitreTactics: [
    "tactic", "tactics", "kill_chain", "killchain", "mitre_tactic", "mitre_tactics",
    "phase", "attack_phase",
  ],
  dataSources: [
    "datasource", "data_source", "data_sources", "logsource", "log_source", "source",
    "telemetry", "data_required", "required_data", "log_sources",
  ],
  sourceRowRef: [],
};

/**
 * Vendor / product prefixes stripped from headers when looking up aliases.
 * E.g. "splunk_mde_use_case_name" tries the prefix-stripped variant
 * "mde_use_case_name", then "use_case_name", which matches the `name` alias.
 */
const VENDOR_PREFIXES = [
  "splunk", "spl", "splunkenterprise", "es",
  "mde", "msdefender", "microsoft_defender", "defender", "microsoftdefender",
  "sentinel", "azure_sentinel", "azuresentinel", "msentinel",
  "elastic", "elasticsearch", "kibana", "eck",
  "qradar", "ibm", "ibmqradar", "ibm_qradar",
  "crowdstrike", "cs", "falcon", "cstrike",
  "carbonblack", "carbon_black", "cb", "vmware_carbon_black",
  "panther", "chronicle", "google_chronicle", "sumo", "sumologic",
  "logrhythm", "exabeam", "securonix", "arcsight", "rapid7",
];

function normaliseHeader(s: string): string {
  return (s || "")
    .trim()
    .toLowerCase()
    // Treat /, :, ., -, _, whitespace, ampersand, parens as the same separator.
    // Keeps the alphanumeric core so "Splunk/MDE Use Case Name" maps cleanly to
    // "splunk_mde_use_case_name", which can then have prefixes stripped.
    .replace(/[\/:.\-_\s&()]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findField(row: Record<string, string>, field: keyof ParsedRow): string | undefined {
  const aliases = COLUMN_ALIASES[field];
  for (const k of Object.keys(row)) {
    const head = normaliseHeader(k);
    if (aliases.includes(head)) return row[k];

    // Strip vendor prefixes one layer at a time (handles "splunk_mde_use_case_name"
    // and similar multi-vendor labels). Cap at 3 strip passes.
    let stripped = head;
    for (let pass = 0; pass < 3; pass++) {
      let removed = false;
      for (const vp of VENDOR_PREFIXES) {
        if (stripped.startsWith(vp + "_")) {
          stripped = stripped.slice(vp.length + 1);
          removed = true;
          break;
        }
      }
      if (!removed) break;
      if (aliases.includes(stripped)) return row[k];
    }
  }
  return undefined;
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,;|\n]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Map of well-known LOLBin / tool / behavior keywords → MITRE technique IDs.
 * Used as a fallback when a row's text doesn't carry explicit `T####` IDs.
 * Tuned for high-precision matches on widely-used Windows / Linux / cloud
 * patterns. Each row maps a regex over the source text to one or more
 * technique IDs.
 *
 * Add new mappings here when you encounter another well-known pattern that
 * should reliably produce a technique inference.
 */
const TECHNIQUE_KEYWORDS: Array<[RegExp, string[]]> = [
  // ─── Credential Access ─────────────────────────────────────────────────
  [/\b(?:comsvcs\.dll|minidump|mimikatz|sekurlsa|invoke[- ]?mimikatz|lsass(?:\.exe)?\s+dump|procdump\s+lsass)\b/i, ["T1003.001"]],
  [/\bntds\.dit\b|\bntdsutil\b/i, ["T1003.003"]],
  [/\b(?:dcsync|drsuapi|getncchanges|replicate[- ]?single[- ]?object)\b/i, ["T1003.006"]],
  [/\b(?:hashcat|john[- ]?the[- ]?ripper|kerberoast(?:ing)?|asreproast)\b/i, ["T1110.003", "T1558"]],
  [/\bbrute[ -]?force(?:\s+attack)?\b/i, ["T1110"]],

  // ─── Execution / LOLBins ───────────────────────────────────────────────
  [/\bcertutil(?:\.exe)?\b.*\b(?:-decode|-decodehex|-urlcache|-encode|-split|-f\b|-verifyctl)\b/i, ["T1140", "T1105"]],
  [/\bcertutil(?:\.exe)?\b/i, ["T1140"]],
  [/\bbitsadmin(?:\.exe)?\b/i, ["T1197", "T1105"]],
  [/\brundll32(?:\.exe)?\b/i, ["T1218.011"]],
  [/\bregsvr32(?:\.exe)?\b/i, ["T1218.010"]],
  [/\bmshta(?:\.exe)?\b/i, ["T1218.005"]],
  [/\binstallutil(?:\.exe)?\b/i, ["T1218.004"]],
  [/\bmsbuild(?:\.exe)?\b/i, ["T1127.001"]],
  [/\b(?:powershell|pwsh)(?:\.exe)?\b.*?\b(?:-enc|-encodedcommand|frombase64string|iex\b|invoke[- ]?expression|downloadstring)\b/i, ["T1059.001", "T1027"]],
  [/\b(?:powershell|pwsh)(?:\.exe)?\b/i, ["T1059.001"]],
  [/\bcmd(?:\.exe)?\s+\/c\b|\bcmd(?:\.exe)?\s+\/k\b/i, ["T1059.003"]],
  [/\b(?:wscript|cscript)(?:\.exe)?\b/i, ["T1059.005"]],
  [/\bpython(?:\.exe)?\b.*\b(?:-c|exec\(|os\.system|subprocess)\b/i, ["T1059.006"]],
  [/\bbash\s+-i\b|\bsh\s+-c\b/i, ["T1059.004"]],

  // ─── Persistence ───────────────────────────────────────────────────────
  [/\bschtasks(?:\.exe)?\b|\bscheduled[ _-]*task\b/i, ["T1053.005"]],
  [/\b(?:sc(?:\.exe)?\s+create|new[- ]?service)\b/i, ["T1543.003"]],
  [/\b(?:run\s+key|currentversion\\run|hkcu.*run|hklm.*run)\b/i, ["T1547.001"]],
  [/\bwmi[- ]?(?:event[- ]?subscription|event[- ]?filter)\b/i, ["T1546.003"]],

  // ─── Discovery ─────────────────────────────────────────────────────────
  [/\bwhoami(?:\.exe)?\b|\bnet\s+user\b|\bnet\s+group\b/i, ["T1087"]],
  [/\b(?:netstat|ipconfig|arp)(?:\.exe)?\b/i, ["T1016"]],
  [/\b(?:net\s+view|nltest|nbtstat)\b/i, ["T1018"]],
  [/\btasklist(?:\.exe)?\b|\bget[- ]?process\b/i, ["T1057"]],
  [/\bsysteminfo(?:\.exe)?\b|\bget[- ]?computerinfo\b/i, ["T1082"]],

  // ─── Lateral Movement ──────────────────────────────────────────────────
  [/\b(?:psexec|paexec)(?:\.exe)?\b/i, ["T1021.002"]],
  [/\b(?:winrm|invoke[- ]?command|enter[- ]?pssession)\b/i, ["T1021.006"]],
  [/\b(?:wmic|wmiexec)(?:\.exe)?\b/i, ["T1047"]],
  [/\b(?:xfreerdp|mstsc(?:\.exe)?|rdesktop)\b/i, ["T1021.001"]],
  [/\b(?:ssh|scp|sftp)\s+(?:-i|-p\b)/i, ["T1021.004"]],

  // ─── Defense Evasion ───────────────────────────────────────────────────
  [/\b(?:add|set)[- ]?mppreference\b|\bdisable[- ]?(?:realtime|defender)\b/i, ["T1562.001"]],
  [/\b(?:event\s+log.*clear|clear[- ]?eventlog|wevtutil\s+cl)\b/i, ["T1070.001"]],
  [/\b(?:vssadmin\s+delete|wbadmin\s+delete)\b/i, ["T1490"]],
  [/\bsdelete(?:\.exe)?\b|\bcipher\s+\/w\b/i, ["T1070.004"]],

  // ─── Exfil / C2 / Ingress ──────────────────────────────────────────────
  [/\b(?:nslookup|dnscat|iodine)\b/i, ["T1071.004"]],
  [/\b(?:curl|wget|invoke[- ]?webrequest|new[- ]?object\s+net\.webclient|net\.webclient)\b/i, ["T1105"]],

  // ─── Cloud (AWS / Azure / GCP) ─────────────────────────────────────────
  [/\bcreateuser\b.*\b(?:iam|aws)\b/i, ["T1136.003"]],
  [/\bconsolelogin\b/i, ["T1078.004"]],
  [/\bupdateassumerolepolicy\b/i, ["T1098.001"]],
  [/\b(?:azure\s+ad|entra\s+id)\b.*\b(?:role|admin|consent)\b/i, ["T1098.003"]],
  [/\b(?:s3|blob)\b.*\b(?:public|listobjects|getobject)\b/i, ["T1530"]],

  // ─── Web / Initial Access ──────────────────────────────────────────────
  [/\b(?:w3wp|webshell|china[- ]?chopper|godzilla|behinder)\b/i, ["T1505.003"]],
  [/\b(?:jndi:|log4j|log4shell|cve[- ]?2021[- ]?44228)\b/i, ["T1190"]],
  [/\bproxy(?:shell|not[- ]?shell|logon)\b/i, ["T1190"]],

  // ─── Containers / K8s ──────────────────────────────────────────────────
  [/\b(?:kubectl|kube[- ]?api|docker\s+(?:exec|run))\b/i, ["T1611"]],
];

/**
 * Extract MITRE technique IDs from arbitrary source text.
 * Combines explicit `T####` regex hits with keyword-driven inference for
 * well-known LOLBins, tools, and behaviour patterns.
 */
function extractTechniques(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();

  // 1. Explicit T-codes
  const re = /\bT\d{4}(?:\.\d{3})?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[0].toUpperCase());

  // 2. Keyword-driven inference (cap at 6 unique inferred techniques to
  //    avoid runaway matches on broad keywords).
  let inferred = 0;
  for (const [pattern, ids] of TECHNIQUE_KEYWORDS) {
    if (inferred >= 6) break;
    if (pattern.test(text)) {
      for (const id of ids) {
        if (!out.has(id)) {
          out.add(id);
          inferred++;
          if (inferred >= 6) break;
        }
      }
    }
  }

  return [...out];
}

function blankRow(sourceRowRef: string): ParsedRow {
  return {
    name: "", description: "", detectionLogic: "",
    severity: "", owner: "",
    platforms: [], mitreTechniques: [], mitreTactics: [], dataSources: [],
    sourceRowRef,
  };
}

/**
 * Derive a human-readable name from a filename when no explicit name column
 * matched. Strips the extension, common prefixes like `mitre_technique_` /
 * `detection_` / `usecase_`, and title-cases the remainder.
 *
 *   "mitre_technique_certutil_command_lolbins_execution.txt"
 *     → "Certutil Command Lolbins Execution"
 */
function nameFromFilename(filename: string): string {
  if (!filename) return "";
  const stem = filename.replace(/\.[^.]+$/, "");
  const cleaned = stem
    .replace(/^(?:mitre[_-]?technique|detection|use[_-]?case|usecase|rule|sigma|spl|kql)[_-]/i, "")
    .replace(/[_\-.]+/g, " ")
    .trim();
  return cleaned.replace(/\b(\w)(\w*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase());
}

function rowFromKeyValue(map: Record<string, string>, sourceRowRef: string): ParsedRow {
  const r = blankRow(sourceRowRef);
  r.name = (findField(map, "name") || "").trim();
  r.description = (findField(map, "description") || "").trim();
  r.detectionLogic = (findField(map, "detectionLogic") || "").trim();
  r.severity = (findField(map, "severity") || "").trim();
  r.owner = (findField(map, "owner") || "").trim();
  r.platforms = splitList(findField(map, "platforms"));
  r.mitreTactics = splitList(findField(map, "mitreTactics"));
  r.dataSources = splitList(findField(map, "dataSources"));
  // Techniques: explicit column OR regex scan over name+description+detection
  const explicit = splitList(findField(map, "mitreTechniques"));
  if (explicit.length) {
    r.mitreTechniques = explicit.map((t) => t.toUpperCase()).filter((t) => /^T\d{4}(\.\d{3})?$/.test(t));
  } else {
    r.mitreTechniques = extractTechniques([r.name, r.description, r.detectionLogic].join(" "));
  }
  return r;
}

// ─── xlsx ─────────────────────────────────────────────────────────────────
function iterateXlsx(buf: Buffer, filename: string): IteratorResult {
  const errors: IteratorResult["errors"] = [];
  let book: XLSX.WorkBook;
  try { book = XLSX.read(buf, { type: "buffer" }); }
  catch (e: any) {
    return { format: "xlsx", rows: [], errors: [{ row: "file", message: `Cannot read workbook: ${e?.message || e}` }] };
  }
  const rows: ParsedRow[] = [];
  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName];
    const arr = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", blankrows: false });
    for (let i = 0; i < arr.length; i++) {
      const ref = `${sheetName}!Row${i + 2}`;                       // header is row 1; data starts row 2
      try {
        const row = rowFromKeyValue(arr[i], ref);
        // For single-row workbooks (most common in the wild), fall back to the
        // filename when no name column matched.
        if (!row.name && arr.length === 1) row.name = nameFromFilename(filename);
        // Skip rows that are entirely empty (e.g. trailing blank)
        const anyContent = row.name || row.description || row.detectionLogic;
        if (!anyContent) continue;
        rows.push(row);
      } catch (e: any) {
        errors.push({ row: ref, message: e?.message || String(e) });
      }
    }
  }
  return { format: "xlsx", rows, errors };
}

// ─── csv ──────────────────────────────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

function iterateCsv(text: string, filename: string): IteratorResult {
  const errors: IteratorResult["errors"] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return { format: "csv", rows: [], errors: [{ row: "file", message: "CSV must have a header row + at least one data row" }] };
  const headers = parseCsvLine(lines[0]);
  const dataLineCount = lines.slice(1).filter((l) => l.trim()).length;
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const cells = parseCsvLine(line);
      const map: Record<string, string> = {};
      for (let h = 0; h < headers.length; h++) map[headers[h]] = (cells[h] ?? "").trim();
      const row = rowFromKeyValue(map, `Row ${i + 1}`);
      if (!row.name && dataLineCount === 1) row.name = nameFromFilename(filename);
      if (!(row.name || row.description || row.detectionLogic)) continue;
      rows.push(row);
    } catch (e: any) {
      errors.push({ row: `Row ${i + 1}`, message: e?.message || String(e) });
    }
  }
  return { format: "csv", rows, errors };
}

// ─── md (Markdown) ────────────────────────────────────────────────────────
function iterateMd(text: string, filename: string): IteratorResult {
  // Split on H1 / H2 boundaries. Each section's first heading becomes the name;
  // the section body becomes the description; the first fenced code block
  // becomes the detection logic.
  const rows: ParsedRow[] = [];
  const errors: IteratorResult["errors"] = [];
  const sections: Array<{ heading: string; body: string }> = [];
  const headingRe = /^(#{1,2})\s+(.+)$/gm;
  let lastIndex = 0;
  let lastHeading = "";
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    if (lastHeading) {
      sections.push({ heading: lastHeading, body: text.slice(lastIndex, m.index).trim() });
    }
    lastHeading = m[2].trim();
    lastIndex = m.index + m[0].length;
  }
  if (lastHeading) sections.push({ heading: lastHeading, body: text.slice(lastIndex).trim() });

  if (sections.length === 0) {
    // No headings — treat the whole file as one use case
    const fence = text.match(/```[a-z0-9]*\n([\s\S]*?)```/);
    const row = blankRow("Section: (root)");
    row.name = nameFromFilename(filename) || "Markdown upload";
    row.description = text.split(/```/)[0].trim().slice(0, 2000);
    row.detectionLogic = fence ? fence[1].trim() : text.trim();
    row.mitreTechniques = extractTechniques(text);
    rows.push(row);
    return { format: "md", rows, errors };
  }

  for (const s of sections) {
    try {
      const ref = `Section: ${s.heading.slice(0, 60)}`;
      const row = blankRow(ref);
      row.name = s.heading;
      const fence = s.body.match(/```([a-z0-9]*)\n([\s\S]*?)```/);
      row.detectionLogic = fence ? fence[2].trim() : "";
      // Description: everything before the first code fence (or all if no fence)
      row.description = (fence ? s.body.slice(0, fence.index!) : s.body).trim();
      row.mitreTechniques = extractTechniques([row.name, row.description, row.detectionLogic].join(" "));
      if (!(row.name || row.description || row.detectionLogic)) continue;
      rows.push(row);
    } catch (e: any) {
      errors.push({ row: `Section: ${s.heading}`, message: e?.message || String(e) });
    }
  }
  return { format: "md", rows, errors };
}

// ─── txt (free-form blocks) ───────────────────────────────────────────────
function iterateTxt(text: string, filename: string): IteratorResult {
  // Blank-line-separated blocks. Each block: optional `key: value` lines at
  // the top + free-form body after a blank inner line. If a block has no
  // key/value structure, the whole block goes into description and the first
  // line becomes the name.
  const rows: ParsedRow[] = [];
  const errors: IteratorResult["errors"] = [];
  const blocks = text.split(/\n\s*\n\s*\n+/);   // 3+ blank lines = block boundary; 1-2 blank lines stay in-block
  const totalBlocks = blocks.filter((b) => b.trim()).length;
  let blockIdx = 0;
  for (const block of blocks) {
    blockIdx++;
    if (!block.trim()) continue;
    const ref = `Block ${blockIdx}`;
    try {
      const row = blankRow(ref);
      const lines = block.split(/\r?\n/);
      const headerKv: Record<string, string> = {};
      let bodyStartIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) { bodyStartIdx = i + 1; break; }
        const colon = line.indexOf(":");
        if (colon < 0) { bodyStartIdx = i; break; }
        const key = line.slice(0, colon).trim();
        const val = line.slice(colon + 1).trim();
        // Permissive header-key regex. Common vendor-style header keys often
        // include `/`, `&`, `(`, `)`, `[`, `]`, `.`, `+` — e.g.
        //   "Splunk/MDE Use Case Name", "ATT&CK Technique", "MITRE Tactic (Killchain)"
        // We allow alphanumeric + the punctuation set, cap length at 80, and
        // require the key starts with a letter.
        if (!/^[A-Za-z][A-Za-z0-9_\-/&().\[\]+\s]{0,80}$/.test(key)) { bodyStartIdx = i; break; }
        headerKv[key] = val;
      }
      const bodyLines = lines.slice(bodyStartIdx).join("\n").trim();
      if (Object.keys(headerKv).length === 0) {
        // No header section — treat first line as name + rest as detectionLogic
        row.name = lines[0].slice(0, 200);
        row.description = lines.slice(1).join("\n").trim().slice(0, 2000);
        row.detectionLogic = block.trim();
      } else {
        // Use heuristics for headerKv
        const tmpRow = rowFromKeyValue(headerKv, ref);
        Object.assign(row, tmpRow);
        // If no detectionLogic in headers, the body becomes the logic
        if (!row.detectionLogic) row.detectionLogic = bodyLines;
        else if (bodyLines && !row.description) row.description = bodyLines;
      }
      row.mitreTechniques = row.mitreTechniques.length
        ? row.mitreTechniques
        : extractTechniques([row.name, row.description, row.detectionLogic].join(" "));
      // Filename fallback when no name was extracted from headers or first
      // line (single-block files most commonly need this).
      if (!row.name && totalBlocks === 1) row.name = nameFromFilename(filename);
      if (!(row.name || row.description || row.detectionLogic)) continue;
      rows.push(row);
    } catch (e: any) {
      errors.push({ row: ref, message: e?.message || String(e) });
    }
  }
  return { format: "txt", rows, errors };
}

// ─── single-rule passthroughs (sigma/spl/kql/yaml/toml/yara) ──────────────
function iterateSingleRule(text: string, format: EnterpriseUploadFormat, filename: string): IteratorResult {
  const row = blankRow("Single rule");
  row.detectionLogic = text.trim();
  // Try to pull title from common patterns
  if (format === "sigma" || format === "yaml") {
    const m = text.match(/^title\s*:\s*(.+)$/im);
    if (m) row.name = m[1].trim().slice(0, 200);
    const desc = text.match(/^description\s*:\s*(.+)$/im);
    if (desc) row.description = desc[1].trim().slice(0, 2000);
    const lvl = text.match(/^level\s*:\s*(\w+)/im);
    if (lvl) row.severity = lvl[1].toLowerCase();
    const author = text.match(/^author\s*:\s*(.+)$/im);
    if (author) row.owner = author[1].trim().slice(0, 200);
    // logsource → platforms hint
    const ls = text.match(/^\s*product\s*:\s*(\w+)/im);
    if (ls) row.platforms = [ls[1].toLowerCase()];
  }
  if (format === "toml") {
    const name = text.match(/^name\s*=\s*"([^"]+)"/m);
    if (name) row.name = name[1].slice(0, 200);
    const desc = text.match(/^description\s*=\s*"([^"]+)"/m);
    if (desc) row.description = desc[1].slice(0, 2000);
    const sev = text.match(/^severity\s*=\s*"(\w+)"/m);
    if (sev) row.severity = sev[1].toLowerCase();
    // platform field
    const plat = text.match(/^platform\s*=\s*"(\w+)"/m);
    if (plat) row.platforms = [plat[1].toLowerCase()];
  }
  if (!row.name) row.name = nameFromFilename(filename) || filename.replace(/\.[^.]+$/, "");
  row.mitreTechniques = extractTechniques(text);
  return { format, rows: [row], errors: [] };
}

// ─── Format sniffing ───────────────────────────────────────────────────────
const EXT_TO_FORMAT: Record<string, EnterpriseUploadFormat> = {
  xlsx: "xlsx", xlsm: "xlsx", xls: "xlsx",
  csv: "csv", tsv: "csv",
  md: "md", markdown: "md",
  txt: "txt", text: "txt",
  yml: "yaml", yaml: "yaml",
  toml: "toml",
  spl: "spl", kql: "kql",
  yara: "yara", yar: "yara",
};

function detectFormat(filename: string, declaredFormat: string | undefined, head: string): EnterpriseUploadFormat {
  if (declaredFormat && declaredFormat !== "unknown") return declaredFormat as EnterpriseUploadFormat;
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (EXT_TO_FORMAT[ext]) {
    // YAML/Sigma disambiguation
    if (ext === "yml" || ext === "yaml") return /^title\s*:|^detection\s*:/im.test(head) ? "sigma" : "yaml";
    return EXT_TO_FORMAT[ext];
  }
  // Content sniff fallback
  if (/^title\s*:|^detection\s*:|^logsource\s*:/im.test(head)) return "sigma";
  if (/^\s*\[metadata\]|^\s*\[rule\]|^rule_id\s*=/im.test(head)) return "toml";
  if (/^index=|^\s*search\b|\bsourcetype=|\bstats\s+count\b/im.test(head)) return "spl";
  if (/\bDeviceProcessEvents\b|\bSecurityEvent\b|\|\s*where\b|\|\s*project\b/im.test(head)) return "kql";
  if (/^#{1,2}\s|^```/m.test(head)) return "md";
  return "txt";
}

export function iterateUpload({ filename, buffer, declaredFormat }: {
  filename: string;
  buffer: Buffer;
  declaredFormat?: string;
}): IteratorResult {
  // For binary formats (xlsx) we can't read as text first
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
    return iterateXlsx(buffer, filename);
  }
  const text = buffer.toString("utf-8");
  const head = text.slice(0, 4096);
  const fmt = detectFormat(filename, declaredFormat, head);
  switch (fmt) {
    case "xlsx": return iterateXlsx(buffer, filename);
    case "csv":  return iterateCsv(text, filename);
    case "md":   return iterateMd(text, filename);
    case "txt":  return iterateTxt(text, filename);
    case "sigma":
    case "spl":
    case "kql":
    case "yaml":
    case "toml":
    case "yara": return iterateSingleRule(text, fmt, filename);
    default:     return iterateSingleRule(text, "txt", filename);
  }
}
