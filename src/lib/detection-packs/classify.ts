/**
 * Heuristic platform-category classifier.
 *
 * Best-effort signal from technique IDs, telemetry keywords, and raw text.
 * The LLM gets this as a HINT and may override it based on the full context.
 *
 * Categories MUST match the enum on DetectionPack.category:
 *   web | network | os-windows | os-linux | os-macos | cloud | identity | email | third-party | other
 */

export type DetectionCategory =
  | "web" | "network"
  | "os-windows" | "os-linux" | "os-macos"
  | "cloud" | "identity" | "email" | "third-party" | "other";

interface ClassifierInput {
  /** Joined text from title + description + summary + IOC blobs. */
  text: string;
  /** ATT&CK technique IDs (e.g. ["T1003.001"]). */
  techniques: string[];
}

// Technique-id buckets — single-source-of-truth for category routing
const CLOUD_TIDS  = /^T15[1-9]\d|^T156\d|^T1078\.004|^T1098\.001|^T1098\.003|^T1136\.003|^T1110\.001/i;
const ID_TIDS     = /^T1078|^T1110|^T1556|^T1098|^T1212|^T1606/i;
const EMAIL_TIDS  = /^T1566|^T1114|^T1534/i;
const NET_TIDS    = /^T1046|^T1049|^T1071|^T1090|^T1095|^T1018|^T1199/i;
const WEB_TIDS    = /^T1190|^T1505\.003|^T1185|^T1059\.007|^T1217|^T1071\.001/i;

const WIN_KW = /windows|sysmon|powershell|cmd\.exe|lsass|comsvcs|defender|wmi\b|active directory/i;
const LIN_KW = /linux|bash\b|systemd|cron\b|\/etc\/|elf binary|wget|curl/i;
const MAC_KW = /\bmacos\b|osx|launchd|launchctl|plist/i;
const CLOUD_KW = /aws|amazon|cloudtrail|iam|ec2|s3|gcp|google cloud|azure|m365|office ?365|saas/i;
const ID_KW = /azure ?ad|entra|okta|saml|oauth|sso|kerberos|krbtgt|pass(?:word)? spray|brute ?force/i;
const EMAIL_KW = /phish|email|smtp|exchange|outlook|m365/i;
const NET_KW = /zeek|netflow|firewall|c2\b|command and control|dns tunnel|http beacon|tls fingerprint/i;
const WEB_KW = /webshell|http\b|apache|nginx|web app|sql ?injection|xss|drive-?by|browser/i;
const THIRD_KW = /vmware|sap\b|salesforce|atlassian|crowdstrike|defender for endpoint|crowdstrike falcon|servicenow|github actions/i;

export function classifyPlatform({ text, techniques }: ClassifierInput): DetectionCategory {
  const t = (techniques || []).join(" ");
  // 1) Technique-id signal
  if (CLOUD_TIDS.test(t)) return "cloud";
  if (EMAIL_TIDS.test(t)) return "email";
  if (ID_TIDS.test(t))    return "identity";
  if (WEB_TIDS.test(t))   return "web";
  if (NET_TIDS.test(t))   return "network";

  // 2) Keyword signal — count hits in each bucket
  const buckets: Array<[DetectionCategory, number]> = [
    ["cloud",      score(text, CLOUD_KW)],
    ["identity",   score(text, ID_KW)],
    ["email",      score(text, EMAIL_KW)],
    ["network",    score(text, NET_KW)],
    ["web",        score(text, WEB_KW)],
    ["third-party",score(text, THIRD_KW)],
    ["os-windows", score(text, WIN_KW)],
    ["os-linux",   score(text, LIN_KW)],
    ["os-macos",   score(text, MAC_KW)],
  ];
  buckets.sort((a, b) => b[1] - a[1]);
  if (buckets[0][1] > 0) return buckets[0][0];

  return "other";
}

function score(text: string, re: RegExp): number {
  const m = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
  return m ? m.length : 0;
}
