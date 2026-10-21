/**
 * Per-framework Docker deploy adapters for the first automated wave.
 *
 * Each adapter encodes ONE framework's documented bring-up as ordered shell
 * steps, so `deploy-generic.ts` stays framework-agnostic. Commands mirror each
 * project's official install docs (clone → build/pull → start), streamed to the
 * deploy log; a real Docker host + server-side internet are required to run
 * them (endpoints stay offline). Ports/creds are surfaced back to the C2Server.
 *
 * These are wired to the projects' documented flows and must be validated on a
 * self-hosted Docker host (see the plan's verification step 5).
 */

export interface AdapterCtx {
  workdir: string;      // labs/deployments/<deploymentId>
  repoDir: string;      // <workdir>/repo
  advertiseHost: string;
  adminUser: string;
  adminPassword: string;
  apiKey: string;
}

export interface AdapterStep {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface DockerAdapter {
  id: string;
  /** Shallow-cloned before install() runs (omit to skip clone). */
  repo?: string;
  /** Port to health-check for "running". */
  healthPort: number;
  install(ctx: AdapterCtx): AdapterStep[];
  start(ctx: AdapterCtx): AdapterStep[];
  stop(ctx: AdapterCtx): AdapterStep[];
  teardown(ctx: AdapterCtx): AdapterStep[];
  consoleUrl(ctx: AdapterCtx): string;
  creds(ctx: AdapterCtx): { apiKey?: string; adminUser?: string; adminPassword?: string };
}

const min = (n: number) => n * 60_000;

/** Mythic — Docker-native; `mythic-cli` orchestrates the containers. */
const mythic: DockerAdapter = {
  id: "mythic",
  repo: "https://github.com/its-a-feature/Mythic",
  healthPort: 7443,
  install: (c) => [
    // Build the mythic-cli, seed .env with our admin creds + bind address.
    { cmd: "make", args: [], cwd: c.repoDir, timeoutMs: min(20) },
    // Values are passed as positional args ($1/$2), never spliced into the script text.
    { cmd: "bash", args: ["-c", `printf 'MYTHIC_ADMIN_USER=%s\\nMYTHIC_ADMIN_PASSWORD=%s\\nMYTHIC_SERVER_BIND_LOCALHOST_ONLY=false\\nNGINX_PORT=7443\\n' "$1" "$2" >> .env`, "bash", c.adminUser, c.adminPassword], cwd: c.repoDir, timeoutMs: min(1) },
  ],
  start: (c) => [{ cmd: "./mythic-cli", args: ["start"], cwd: c.repoDir, timeoutMs: min(15) }],
  stop: (c) => [{ cmd: "./mythic-cli", args: ["stop"], cwd: c.repoDir, timeoutMs: min(5) }],
  teardown: (c) => [{ cmd: "./mythic-cli", args: ["stop"], cwd: c.repoDir, timeoutMs: min(5) }],
  consoleUrl: (c) => `https://${c.advertiseHost}:7443`,
  creds: (c) => ({ adminUser: c.adminUser, adminPassword: c.adminPassword }),
};

/** Havoc — team server via the repo's docker path; client is operator-side. */
const havoc: DockerAdapter = {
  id: "havoc",
  repo: "https://github.com/HavocFramework/Havoc",
  healthPort: 40056,
  install: (c) => [
    { cmd: "docker", args: ["compose", "build"], cwd: c.repoDir, timeoutMs: min(30) },
  ],
  start: (c) => [{ cmd: "docker", args: ["compose", "up", "-d"], cwd: c.repoDir, timeoutMs: min(10) }],
  stop: (c) => [{ cmd: "docker", args: ["compose", "stop"], cwd: c.repoDir, timeoutMs: min(5) }],
  teardown: (c) => [{ cmd: "docker", args: ["compose", "down", "-v"], cwd: c.repoDir, timeoutMs: min(5) }],
  consoleUrl: (c) => `${c.advertiseHost}:40056`,
  creds: (c) => ({ adminUser: c.adminUser, adminPassword: c.adminPassword }),
};

/** Empire — official docker-compose (BC-Security), Starkiller on :5000. */
const empire: DockerAdapter = {
  id: "empire",
  repo: "https://github.com/BC-SECURITY/Empire",
  healthPort: 1337,
  install: (c) => [
    { cmd: "docker", args: ["compose", "pull"], cwd: c.repoDir, timeoutMs: min(20) },
  ],
  start: (c) => [{ cmd: "docker", args: ["compose", "up", "-d"], cwd: c.repoDir, timeoutMs: min(10) }],
  stop: (c) => [{ cmd: "docker", args: ["compose", "stop"], cwd: c.repoDir, timeoutMs: min(5) }],
  teardown: (c) => [{ cmd: "docker", args: ["compose", "down", "-v"], cwd: c.repoDir, timeoutMs: min(5) }],
  consoleUrl: (c) => `http://${c.advertiseHost}:1337`,
  creds: (c) => ({ apiKey: c.apiKey, adminUser: c.adminUser, adminPassword: c.adminPassword }),
};

const ADAPTERS: Record<string, DockerAdapter> = { mythic, havoc, empire };

export function getDockerAdapter(composeRef: string): DockerAdapter | null {
  return ADAPTERS[composeRef] || null;
}
