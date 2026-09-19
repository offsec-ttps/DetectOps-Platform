/**
 * Curated baseline of well-known ransomware gangs with hand-mapped MITRE
 * techniques + representative, PUBLIC IOCs (ransom-note filenames, behavioral
 * LOLBin commands) and detection signatures (Sigma/YARA names). Sourced from
 * public CISA #StopRansomware advisories + vendor reporting. Guarantees the page
 * shows TTPs/IOCs/signatures offline; collectors augment leak-site/victim data.
 * Idempotent — fills empty fields on existing rows.
 */

import { prisma } from "@/lib/prisma";

interface SeedGang {
  name: string; aliases: string[]; status: string; description: string;
  ttps: Array<{ id: string; name: string; tactic: string }>;
  sectors: string[]; references: Array<{ title: string; url: string }>;
  iocs: { network: string[]; file: string[]; behavioral: string[] };
  signatures: Array<{ kind: string; name: string; ref?: string }>;
}

const COMMON: Record<string, { id: string; name: string; tactic: string }> = {
  ps:    { id: "T1059.001", name: "PowerShell", tactic: "execution" },
  cmd:   { id: "T1059.003", name: "Windows Command Shell", tactic: "execution" },
  valid: { id: "T1078", name: "Valid Accounts", tactic: "initial-access" },
  cred:  { id: "T1003", name: "OS Credential Dumping", tactic: "credential-access" },
  lsass: { id: "T1003.001", name: "LSASS Memory", tactic: "credential-access" },
  rdp:   { id: "T1021.001", name: "Remote Desktop Protocol", tactic: "lateral-movement" },
  smb:   { id: "T1021.002", name: "SMB/Windows Admin Shares", tactic: "lateral-movement" },
  disc:  { id: "T1083", name: "File and Directory Discovery", tactic: "discovery" },
  share: { id: "T1135", name: "Network Share Discovery", tactic: "discovery" },
  recov: { id: "T1490", name: "Inhibit System Recovery", tactic: "impact" },
  encr:  { id: "T1486", name: "Data Encrypted for Impact", tactic: "impact" },
  exfil: { id: "T1567.002", name: "Exfiltration to Cloud Storage", tactic: "exfiltration" },
  defev: { id: "T1562.001", name: "Disable or Modify Tools", tactic: "defense-evasion" },
  persist:{ id: "T1543.003", name: "Windows Service", tactic: "persistence" },
};
const K = (...keys: (keyof typeof COMMON)[]) => keys.map((k) => COMMON[k]);

// Behavioral IOCs common to most human-operated ransomware (recovery inhibition + log clearing).
const BEH_COMMON = [
  "vssadmin.exe delete shadows /all /quiet",
  "wmic shadowcopy delete",
  "bcdedit /set {default} bootstatuspolicy ignoreallfailures",
  "bcdedit /set {default} recoveryenabled no",
  "wbadmin delete catalog -quiet",
  "wevtutil cl security",
];
const SIG_RECOVERY = { kind: "sigma", name: "Shadow Copies Deletion Using Operating System Utilities", ref: "proc_creation_win_vssadmin_delete_shadowcopies" };

const SEED: SeedGang[] = [
  { name: "LockBit", aliases: ["LockBit 3.0", "LockBit Black", "lockbit3", "lockbit"], status: "active", description: "Prolific RaaS; double-extortion, fastest known encryptor, StealBit exfil tool.", ttps: K("valid","ps","cred","lsass","rdp","smb","defev","recov","encr","exfil"), sectors: ["Manufacturing","Healthcare","Finance"], references: [{ title: "CISA #StopRansomware: LockBit 3.0", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-165a" }],
    iocs: { network: ["StealBit exfiltration tool C2"], file: ["<victim-id>.README.txt", "restore-my-files.txt", "*.lockbit (legacy ext)", "HLJkNskOq (mutex)"], behavioral: [...BEH_COMMON, "rundll32 against legitimate DLL for LSASS dump"] },
    signatures: [SIG_RECOVERY, { kind: "yara", name: "MAL_RANSOM_LockBit3", ref: "Elastic/Florian Roth rules" }, { kind: "sigma", name: "LSASS Memory Dump via Comsvcs DLL", ref: "proc_creation_win_lolbin_comsvcs_lsass" }] },
  { name: "ALPHV", aliases: ["BlackCat", "Noberus", "alphv", "blackcat"], status: "rebranded", description: "Rust-based RaaS; triple extortion, cross-platform (Windows/Linux/ESXi) encryptor.", ttps: K("valid","ps","cred","rdp","disc","defev","recov","encr","exfil"), sectors: ["Energy","Healthcare","Finance"], references: [{ title: "CISA #StopRansomware: ALPHV BlackCat", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-353a" }],
    iocs: { network: ["ExMatter / Exbyte exfiltration", "fendr.net infra (historical)"], file: ["RECOVER-${EXTENSION}-FILES.txt", "checkpoints.<ext>", "access-token (CLI arg)"], behavioral: [...BEH_COMMON, "fsutil behavior set SymlinkEvaluation", "encryptor launched with --access-token"] },
    signatures: [SIG_RECOVERY, { kind: "yara", name: "MAL_Ransom_BlackCat", ref: "Florian Roth rules" }, { kind: "sigma", name: "Suspicious fsutil SymlinkEvaluation", ref: "proc_creation_win_fsutil_symlinkevaluation" }] },
  { name: "Cl0p", aliases: ["Clop", "TA505", "cl0p", "clop"], status: "active", description: "Mass-exploitation of managed file-transfer 0-days (MOVEit, GoAnywhere, Accellion).", ttps: K("valid","ps","disc","exfil","encr","defev"), sectors: ["Finance","Government","Education"], references: [{ title: "CISA #StopRansomware: CL0P MOVEit", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a" }],
    iocs: { network: ["LEMURLOOT webshell (human2.aspx)", "MOVEit Transfer exploitation"], file: ["README_CL0P.txt", "!_READ_ME.RTF", "human2.aspx"], behavioral: ["SQL injection against MOVEit Transfer", "webshell deployment to wwwroot"] },
    signatures: [{ kind: "sigma", name: "LEMURLOOT Webshell Access", ref: "web_moveit_lemurloot" }, { kind: "yara", name: "MAL_Webshell_LEMURLOOT", ref: "Mandiant" }] },
  { name: "Play", aliases: ["PlayCrypt", "play"], status: "active", description: "Intermittent encryption; abuses valid accounts + public-facing apps (FortiOS, Exchange).", ttps: K("valid","ps","cmd","cred","rdp","disc","recov","encr"), sectors: ["Government","Manufacturing"], references: [{ title: "CISA #StopRansomware: Play", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-352a" }],
    iocs: { network: ["Cobalt Strike beacons", "SystemBC RAT"], file: ["ReadMe.txt", "*.play (extension)"], behavioral: [...BEH_COMMON, "Grixba info-stealer execution", "AdFind / nltest domain recon"] },
    signatures: [SIG_RECOVERY, { kind: "sigma", name: "AdFind Usage Reconnaissance", ref: "proc_creation_win_adfind_enumeration" }] },
  { name: "Akira", aliases: ["akira"], status: "active", description: "Targets VPNs lacking MFA (Cisco ASA); Windows + Linux/ESXi encryptors.", ttps: K("valid","ps","cred","lsass","rdp","smb","defev","recov","encr","exfil"), sectors: ["Education","Manufacturing","Finance"], references: [{ title: "CISA #StopRansomware: Akira", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-109a" }],
    iocs: { network: ["Cisco ASA VPN brute force (no MFA)", "AnyDesk / RustDesk remote access"], file: ["akira_readme.txt", "*.akira (extension)", "*.powerranges"], behavioral: [...BEH_COMMON, "PCHunter / nltest discovery", "WinRAR/Rclone staging for exfil"] },
    signatures: [SIG_RECOVERY, { kind: "yara", name: "MAL_Ransom_Akira", ref: "Florian Roth rules" }, { kind: "sigma", name: "Rclone Execution to Cloud", ref: "proc_creation_win_rclone_exec" }] },
  { name: "Black Basta", aliases: ["BlackBasta", "blackbasta", "black basta"], status: "active", description: "Likely Conti successor; QakBot/Cobalt Strike tradecraft, ESXi encryptor.", ttps: K("valid","ps","cmd","cred","lsass","rdp","smb","defev","recov","encr"), sectors: ["Healthcare","Manufacturing"], references: [{ title: "CISA #StopRansomware: Black Basta", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-131a" }],
    iocs: { network: ["QakBot loader", "Cobalt Strike", "SystemBC"], file: ["readme.txt", "*.basta (extension)", "instructions_read_me.txt"], behavioral: [...BEH_COMMON, "softperfect netscan", "BITSAdmin transfer"] },
    signatures: [SIG_RECOVERY, { kind: "yara", name: "MAL_Ransom_BlackBasta", ref: "Florian Roth rules" }] },
  { name: "Royal", aliases: ["BlackSuit", "Royal Ransomware", "royal", "blacksuit"], status: "rebranded", description: "Human-operated; partial encryption, callback (BazarCall) phishing.", ttps: K("valid","ps","cred","rdp","disc","recov","encr","exfil"), sectors: ["Healthcare","Critical Infrastructure"], references: [{ title: "CISA #StopRansomware: Royal", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-061a" }],
    iocs: { network: ["Cobalt Strike", "Chisel tunneling", "callback phishing numbers"], file: ["README.TXT", "*.royal (extension)"], behavioral: [...BEH_COMMON, "PsExec lateral execution", "Nsudo privilege abuse"] },
    signatures: [SIG_RECOVERY, { kind: "sigma", name: "PsExec Service Start", ref: "proc_creation_win_psexec_service" }] },
  { name: "Medusa", aliases: ["MedusaLocker", "medusa"], status: "active", description: "RaaS; exploits public-facing apps + valid accounts, heavy LOLBin use.", ttps: K("valid","ps","cmd","cred","smb","defev","recov","encr"), sectors: ["Education","Healthcare","Technology"], references: [{ title: "CISA #StopRansomware: Medusa", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa25-071a" }],
    iocs: { network: ["ConnectWise ScreenConnect abuse", "Cobalt Strike"], file: ["!READ_ME_MEDUSA!.html", "*.MEDUSA (extension)"], behavioral: [...BEH_COMMON, "gaze.exe encryptor", "certutil download cradle"] },
    signatures: [SIG_RECOVERY, { kind: "sigma", name: "Certutil Download Cradle", ref: "proc_creation_win_certutil_download" }] },
  { name: "Rhysida", aliases: ["rhysida"], status: "active", description: "Phishing + Cobalt Strike; targets education/healthcare/government.", ttps: K("valid","ps","cred","rdp","disc","recov","encr","exfil"), sectors: ["Education","Healthcare","Government"], references: [{ title: "CISA #StopRansomware: Rhysida", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-319a" }],
    iocs: { network: ["Cobalt Strike", "PortStarter backdoor"], file: ["CriticalBreachDetected.pdf", "*.rhysida (extension)"], behavioral: [...BEH_COMMON, "ESXi VM encryption", "PowerShell PsExec deployment"] },
    signatures: [SIG_RECOVERY, { kind: "yara", name: "MAL_Ransom_Rhysida", ref: "Florian Roth rules" }] },
  { name: "BianLian", aliases: ["bianlian"], status: "active", description: "Shifted to pure exfiltration-extortion; valid-account access, Go-based backdoor.", ttps: K("valid","ps","cred","rdp","smb","disc","exfil","defev"), sectors: ["Healthcare","Manufacturing","Professional Services"], references: [{ title: "CISA #StopRansomware: BianLian", url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-136a" }],
    iocs: { network: ["Go-based custom backdoor", "Ngrok / Rsocks tunneling"], file: ["Look at this instruction.txt"], behavioral: ["Advanced Port Scanner / SoftPerfect", "PowerShell Go backdoor execution", "rclone/mega exfil"] },
    signatures: [{ kind: "sigma", name: "Ngrok Tunneling Execution", ref: "proc_creation_win_ngrok" }, { kind: "yara", name: "MAL_BianLian_Backdoor", ref: "community" }] },
];

export async function seedGangs(): Promise<{ created: number; filled: number }> {
  let created = 0, filled = 0;
  for (const g of SEED) {
    const existing = await prisma.ransomwareGang.findUnique({ where: { name: g.name } });
    const fields = {
      aliases: JSON.stringify(g.aliases), status: g.status, description: g.description,
      knownTTPs: JSON.stringify(g.ttps), targetSectors: JSON.stringify(g.sectors), references: JSON.stringify(g.references),
      iocs: JSON.stringify(g.iocs), signatures: JSON.stringify(g.signatures),
    };
    if (!existing) {
      await prisma.ransomwareGang.create({ data: { name: g.name, source: "seed", ...fields } });
      created++;
    } else {
      // Fill any empty curated fields without clobbering collector/AI data.
      const patch: any = {};
      if (!existing.knownTTPs || existing.knownTTPs === "[]") patch.knownTTPs = fields.knownTTPs;
      if (!existing.iocs || existing.iocs === "{}" || existing.iocs === '{"network":[],"file":[],"behavioral":[]}') patch.iocs = fields.iocs;
      if (!existing.signatures || existing.signatures === "[]") patch.signatures = fields.signatures;
      if (!existing.aliases || existing.aliases === "[]") patch.aliases = fields.aliases;
      if (Object.keys(patch).length) { await prisma.ransomwareGang.update({ where: { name: g.name }, data: patch }); filled++; }
    }
  }
  return { created, filled };
}

export async function ensureSeeded(): Promise<void> {
  const n = await prisma.ransomwareGang.count();
  if (n === 0) await seedGangs();
}

/** Canonical-name map (normalized name + aliases → seed name) for collector reconciliation. */
export function seedAliasMap(): Map<string, string> {
  const m = new Map<string, string>();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "");
  for (const g of SEED) {
    m.set(norm(g.name), g.name);
    for (const a of g.aliases) m.set(norm(a), g.name);
  }
  return m;
}
