/**
 * Curated catalog of C2 / adversary-emulation frameworks for Fleet Simulation.
 *
 * Purpose: let an operator stand up a real C2 in THEIR OWN authorized lab,
 * generate authentic adversary traffic, and build/tune detections against it.
 * Mirrors the shape of `src/config/lab-templates` (a curated, in-repo, versioned
 * catalog) rather than a DB table — user-imported customs are a deferred phase
 * (see the repo-import design in the plan) and will layer on top with seeded:false.
 *
 * Deployment reality (honest, per-framework):
 *   - method:"provider" → a full C2Provider adapter exists (Caldera): deploy +
 *     health + enrollment + runTechnique wired into the simulation pipeline.
 *   - method:"docker"   → first-wave automated Docker deploy (deploy-generic.ts):
 *     stand up + start/stop/teardown + console URL. Traffic is driven from the
 *     C2's own console; deep runTechnique wiring is a per-framework follow-on.
 *   - method:"manual"   → template + guided steps + docs only ("automated deploy
 *     coming soon"). Steps align to the C2 Matrix how-to at howto.thec2matrix.com.
 *   - method:"none"     → commercial/template-only (no deploy, config upcoming).
 *
 * Data note: ports/resources are sensible defaults from each project's public
 * docs; they are guidance for lab sizing, not a guarantee of a given release.
 */

export type C2Category = "caldera" | "open-source" | "commercial";
export type C2DeployMethod = "provider" | "docker" | "manual" | "none";
export type C2Platform = "windows" | "linux" | "darwin";

export interface C2ConfigOption {
  key: string;
  label: string;
  description: string;
  default?: string;
}

export interface C2CatalogEntry {
  id: string;
  name: string;
  category: C2Category;
  license: "open-source" | "free" | "commercial";
  description: string;
  language?: string;
  repo?: string;
  docsUrl: string;
  /** Deep-link into the C2 Matrix how-to, when one exists. */
  c2MatrixUrl?: string;
  platforms: C2Platform[];
  prerequisites: string[];
  configOptions: C2ConfigOption[];
  resources: { cpus: number; memoryMB: number; diskGB: number; ports: number[] };
  deploy: {
    method: C2DeployMethod;
    /** method:"provider" → maps to a registry C2Provider kind. */
    providerKind?: "caldera";
    /** method:"docker" → adapter id under src/lib/c2/adapters/<composeRef>.ts */
    composeRef?: string;
    /** method:"manual" → ordered guided steps (aligned to the C2 Matrix how-to). */
    guidedSteps?: string[];
    /** false → shown as "automated deploy coming soon". */
    available: boolean;
  };
  /** For commercial/template-only entries: what defenders should hunt for. */
  detectionOpportunities?: string[];
  /** true = built-in/curated; user-imported customs (deferred) will be false. */
  seeded: true;
}

const C2MATRIX = "https://howto.thec2matrix.com/c2";

/** Guided steps shared by "clone + follow upstream install" manual entries. */
const genericManualSteps = (repo: string): string[] => [
  `Provision a dedicated Linux VM in your lab network (isolated from production).`,
  `Clone the project: git clone ${repo}`,
  `Follow the project's install/setup docs for server dependencies.`,
  `Bind the team server / listener to the lab-facing interface only.`,
  `Start the server and confirm the operator console/API is reachable on the LAN.`,
  `Enroll a test beacon on a lab endpoint and generate benign traffic.`,
  `Forward endpoint + network telemetry to your SIEM and build detections.`,
];

export const C2_CATALOG: C2CatalogEntry[] = [
  // ── Caldera (its own top-level category; fully wired provider) ──
  {
    id: "caldera",
    name: "MITRE Caldera",
    category: "caldera",
    license: "open-source",
    language: "Python",
    description:
      "MITRE's adversary-emulation platform with a built-in web GUI, ATT&CK-mapped abilities, and multiple agent options (sandcat, manx). Fully integrated: deploy/connect, enroll beacons, and run techniques from the Campaign Designer.",
    repo: "https://github.com/mitre/caldera",
    docsUrl: "https://caldera.readthedocs.io/",
    c2MatrixUrl: `${C2MATRIX}/caldera`,
    platforms: ["windows", "linux", "darwin"],
    prerequisites: ["Linux host", "Python ≥ 3.9", "Go (compiles sandcat beacons)", "Node/npm (builds the web UI)"],
    configOptions: [
      { key: "advertiseHost", label: "Advertise host", description: "LAN IP baked into the beacon enrollment one-liner + console URL.", default: "auto-detect" },
      { key: "group", label: "Agent group", description: "Caldera group/bucket beacons enroll into.", default: "red" },
    ],
    resources: { cpus: 2, memoryMB: 2048, diskGB: 8, ports: [8888] },
    deploy: { method: "provider", providerKind: "caldera", available: true },
    seeded: true,
  },

  // ── Open-source — first wave (automated Docker deploy) ──
  {
    id: "mythic",
    name: "Mythic",
    category: "open-source",
    license: "open-source",
    language: "Go / Python (Docker)",
    description:
      "Modular, Docker-native C2 with a browser UI. Agents (Apollo, Poseidon, etc.) and C2 profiles install as containers, making it the cleanest framework to stand up automatically.",
    repo: "https://github.com/its-a-feature/Mythic",
    docsUrl: "https://docs.mythic-c2.net/",
    c2MatrixUrl: `${C2MATRIX}/mythic`,
    platforms: ["windows", "linux", "darwin"],
    prerequisites: ["Linux host", "Docker + Docker Compose", "≥ 4 GB RAM", "Outbound internet on the server to pull images"],
    configOptions: [
      { key: "advertiseHost", label: "Advertise host", description: "LAN IP for agent callbacks + the operator UI.", default: "auto-detect" },
      { key: "adminUser", label: "Admin user", description: "Initial Mythic operator account.", default: "mythic_admin" },
    ],
    resources: { cpus: 4, memoryMB: 4096, diskGB: 20, ports: [7443] },
    deploy: { method: "docker", composeRef: "mythic", available: true },
    seeded: true,
  },
  {
    id: "havoc",
    name: "Havoc",
    category: "open-source",
    license: "open-source",
    language: "C / ASM / Go",
    description:
      "Modern, evasive C2 with a Qt client and a Go team server. The Demon agent supports sleep obfuscation and indirect syscalls — a strong source of realistic, current adversary traffic to detect.",
    repo: "https://github.com/HavocFramework/Havoc",
    docsUrl: "https://havocframework.com/docs/welcome",
    c2MatrixUrl: `${C2MATRIX}/havoc`,
    platforms: ["windows"],
    prerequisites: ["Linux host", "Docker + Docker Compose (team server)", "Havoc client on the operator workstation"],
    configOptions: [
      { key: "advertiseHost", label: "Advertise host", description: "LAN IP the team server + listeners advertise.", default: "auto-detect" },
      { key: "listenerPort", label: "Listener port", description: "HTTP/S listener port for Demon callbacks.", default: "443" },
    ],
    resources: { cpus: 2, memoryMB: 2048, diskGB: 10, ports: [40056, 443] },
    deploy: { method: "docker", composeRef: "havoc", available: true },
    seeded: true,
  },
  {
    id: "empire",
    name: "Empire",
    category: "open-source",
    license: "open-source",
    language: "PowerShell / Python",
    description:
      "BC-Security's maintained fork of PowerShell Empire — a post-exploitation C2 with PowerShell and Python agents, a REST API, and the Starkiller web UI. Classic, well-documented traffic for detection baselining.",
    repo: "https://github.com/BC-SECURITY/Empire",
    docsUrl: "https://bc-security.gitbook.io/empire-wiki/",
    c2MatrixUrl: `${C2MATRIX}/empire`,
    platforms: ["windows", "linux"],
    prerequisites: ["Linux host", "Docker + Docker Compose", "Starkiller (bundled) for the web UI"],
    configOptions: [
      { key: "advertiseHost", label: "Advertise host", description: "LAN IP for agent callbacks + REST API.", default: "auto-detect" },
      { key: "adminPassword", label: "Admin password", description: "Initial Empire admin password.", default: "auto-generate" },
    ],
    resources: { cpus: 2, memoryMB: 2048, diskGB: 10, ports: [1337, 5000] },
    deploy: { method: "docker", composeRef: "empire", available: true },
    seeded: true,
  },

  // ── Open-source — template + guided-manual (automated deploy coming soon) ──
  ...([
    { id: "adaptixc2", name: "AdaptixC2", language: "C++ / Go", repo: "https://github.com/Adaptix-Framework/AdaptixC2", docs: "https://github.com/Adaptix-Framework/AdaptixC2", slug: "adaptixc2", platforms: ["windows", "linux"], ports: [4321] },
    { id: "alchimist", name: "Alchimist", language: "Go", repo: "https://github.com/f0rgetting/Alchimist", docs: `${C2MATRIX}/alchimist`, slug: "alchimist", platforms: ["windows", "linux", "darwin"], ports: [8080] },
    { id: "ares", name: "Ares", language: "Python", repo: "https://github.com/sweetsoftware/Ares", docs: `${C2MATRIX}/ares`, slug: "ares", platforms: ["windows", "linux"], ports: [8080] },
    { id: "babyshark", name: "BabyShark", language: "Python", repo: "https://github.com/UnkL4b/BabyShark", docs: `${C2MATRIX}/babyshark`, slug: "babyshark", platforms: ["windows"], ports: [8080] },
    { id: "c3", name: "C3 (Custom Command & Control)", language: "C++ / C#", repo: "https://github.com/WithSecureLabs/C3", docs: `${C2MATRIX}/c3`, slug: "c3", platforms: ["windows"], ports: [] },
    { id: "covenant", name: "Covenant", language: "C# / .NET", repo: "https://github.com/cobbr/Covenant", docs: `${C2MATRIX}/covenant`, slug: "covenant", platforms: ["windows", "linux", "darwin"], ports: [7443, 80, 443] },
    { id: "deimosc2", name: "DeimosC2", language: "Go", repo: "https://github.com/DeimosC2/DeimosC2", docs: `${C2MATRIX}/deimosc2`, slug: "deimosc2", platforms: ["windows", "linux", "darwin"], ports: [8443] },
    { id: "evilosx", name: "EvilOSX", language: "Python", repo: "https://github.com/Marten4n6/EvilOSX", docs: `${C2MATRIX}/evilosx`, slug: "evilosx", platforms: ["darwin"], ports: [1337] },
    { id: "faction", name: "Faction C2", language: "C# / .NET", repo: "https://github.com/FactionC2/Faction", docs: `${C2MATRIX}/faction-c2`, slug: "faction-c2", platforms: ["windows", "linux"], ports: [443] },
    { id: "fudgec2", name: "FudgeC2", language: "PowerShell / Python", repo: "https://github.com/Ziconius/FudgeC2", docs: `${C2MATRIX}/fudgec2`, slug: "fudgec2", platforms: ["windows"], ports: [5000] },
    { id: "ibombshell", name: "ibombshell", language: "PowerShell", repo: "https://github.com/Telefonica/ibombshell", docs: `${C2MATRIX}/ibombshell`, slug: "ibombshell", platforms: ["windows"], ports: [8080] },
    { id: "koadic", name: "Koadic C3", language: "Python / JScript", repo: "https://github.com/offsecginger/koadic", docs: `${C2MATRIX}/koadic`, slug: "koadic", platforms: ["windows"], ports: [9999] },
    { id: "octopus", name: "Octopus", language: "Python", repo: "https://github.com/mhaskar/Octopus", docs: `${C2MATRIX}/octopus`, slug: "octopus", platforms: ["windows"], ports: [8080] },
    { id: "peeko", name: "peeko", language: "JavaScript", repo: "https://github.com/CplGunToting/peeko", docs: `${C2MATRIX}/peeko`, slug: "peeko", platforms: ["windows", "linux", "darwin"], ports: [8080] },
    { id: "powerhub", name: "PowerHub", language: "Python / PowerShell", repo: "https://github.com/AdrianVollmer/PowerHub", docs: `${C2MATRIX}/powerhub`, slug: "powerhub", platforms: ["windows"], ports: [8080] },
    { id: "prismatica", name: "Prismatica", language: "Python", repo: "https://github.com/prismaticaio/prismatica", docs: `${C2MATRIX}/prismatica`, slug: "prismatica", platforms: ["windows", "linux"], ports: [8000] },
    { id: "quasarrat", name: "QuasarRAT", language: "C# / .NET", repo: "https://github.com/quasar/Quasar", docs: `${C2MATRIX}/quasarrat`, slug: "quasarrat", platforms: ["windows"], ports: [4782] },
    { id: "redherd", name: "RedHerd Framework", language: "Python", repo: "https://github.com/redherd-project/redherd-framework", docs: `${C2MATRIX}/redherd-framework`, slug: "redherd-framework", platforms: ["windows", "linux", "darwin"], ports: [8080] },
    { id: "throwback", name: "Throwback", language: "C++ / PHP", repo: "https://github.com/silentbreaksec/Throwback", docs: `${C2MATRIX}/throwback`, slug: "throwback", platforms: ["windows"], ports: [80, 443] },
  ] as const).map((m): C2CatalogEntry => ({
    id: m.id,
    name: m.name,
    category: "open-source",
    license: "open-source",
    language: m.language,
    description: `${m.name} — open-source C2 (${m.language}). Deploy in your lab to generate authentic ${m.name} traffic and build detections. Automated deploy is coming soon; follow the guided steps and the C2 Matrix how-to for now.`,
    repo: m.repo,
    docsUrl: m.docs,
    c2MatrixUrl: `${C2MATRIX}/${m.slug}`,
    platforms: [...m.platforms] as C2Platform[],
    prerequisites: ["Dedicated lab VM (isolated from production)", "See the project's install docs for server dependencies"],
    configOptions: [
      { key: "advertiseHost", label: "Advertise host", description: "LAN IP the listener/team server advertises to beacons.", default: "auto-detect" },
    ],
    resources: { cpus: 2, memoryMB: 2048, diskGB: 10, ports: [...m.ports] },
    deploy: { method: "manual", guidedSteps: genericManualSteps(m.repo), available: false },
    seeded: true,
  })),

  // ── Commercial — template/info only (no deploy; configuration upcoming) ──
  {
    id: "cobalt-strike",
    name: "Cobalt Strike",
    category: "commercial",
    license: "commercial",
    language: "Java",
    description:
      "Commercial adversary-simulation platform (Fortra). The Beacon payload is one of the most emulated real-world threats. Deployment support is not provided — this template surfaces detection opportunities so you can hunt Beacon behaviour whether or not you license it.",
    docsUrl: "https://www.cobaltstrike.com/",
    c2MatrixUrl: `${C2MATRIX}/cobalt-strike`,
    platforms: ["windows"],
    prerequisites: ["Valid commercial license", "Java team server host", "Operator client"],
    configOptions: [],
    resources: { cpus: 2, memoryMB: 2048, diskGB: 10, ports: [50050, 80, 443] },
    deploy: { method: "none", available: false },
    detectionOpportunities: [
      "Default Malleable C2 profiles / named-pipe patterns (e.g. msagent_*, postex_*)",
      "Beacon sleep + jitter timing on HTTP/S callbacks",
      "Process injection / spawnto behaviour (rundll32, dllhost)",
      "Well-known JA3/JA3S TLS fingerprints and default self-signed certs",
    ],
    seeded: true,
  },
  {
    id: "brute-ratel",
    name: "Brute Ratel (BRc4)",
    category: "commercial",
    license: "commercial",
    language: "C",
    description:
      "Commercial red-team C2 (Dark Vortex) with a strong focus on EDR/AV evasion. Deployment support is not provided — this template surfaces detection opportunities for the Badger agent's behaviour.",
    docsUrl: "https://bruteratel.com/",
    c2MatrixUrl: `${C2MATRIX}/brute-ratel-c4`,
    platforms: ["windows"],
    prerequisites: ["Valid commercial license", "Linux team server host", "Operator client"],
    configOptions: [],
    resources: { cpus: 2, memoryMB: 2048, diskGB: 10, ports: [443] },
    deploy: { method: "none", available: false },
    detectionOpportunities: [
      "Badger HTTP/S callback timing and default C2 profiles",
      "Syscall-based process injection and unhooking behaviour",
      "TLS certificate / JA3S fingerprints of the team server",
      "LDAP / SMB reconnaissance patterns post-implant",
    ],
    seeded: true,
  },
];

export function getC2CatalogEntry(id: string): C2CatalogEntry | undefined {
  return C2_CATALOG.find((e) => e.id === id);
}

/** First-wave automated Docker adapters that deploy-generic.ts knows how to run. */
export const DOCKER_FIRST_WAVE = C2_CATALOG.filter((e) => e.deploy.method === "docker").map((e) => e.id);
