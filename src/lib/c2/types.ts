/**
 * C2 provider abstraction for Fleet Simulation.
 *
 * A "C2 provider" is one adversary-emulation C2 framework (MITRE Caldera first;
 * Sliver / OpenBAS later). Each provider knows how to health-check a server,
 * list its beacons, emit a beacon-enrollment one-liner, run one ATT&CK technique
 * over the channel, and (optionally) deploy a standalone managed server.
 *
 * Endpoints run a lightweight in-memory beacon; the SERVER pushes TTPs — so
 * there is no per-endpoint tooling install, no AV exclusions, and no per-run
 * endpoint internet (the beacon binary is pulled from the C2 over the LAN).
 */

import type { C2Server } from "@/generated/prisma/client";
import type { StepRunResult } from "@/lib/enterprise-use-cases/caldera-runner";

export type C2Kind = "caldera" | "sliver" | "openbas";
export type C2Os = "windows" | "linux" | "darwin";

export interface C2Beacon {
  id: string;               // paw / beacon id
  host: string;
  platform: string;
  username?: string;
  privilege?: string;       // Elevated | User | ""
  lastSeen?: string;
  online?: boolean;
}

export interface C2Health {
  ok: boolean;
  agents?: number;
  version?: string;
  error?: string;
}

export interface C2DeployOpts {
  name: string;
  advertiseHost?: string;   // LAN IP to advertise to beacons; auto-detected when empty
  ownerId: string;
  onLog?: (line: string) => void;
}

export interface C2DeployResult {
  url: string;              // base URL beacons + REST API use, e.g. http://<lan-ip>:8888
  apiKey: string;           // plaintext (caller encrypts at rest)
  group: string;
  advertiseHost: string;
  deploymentId: string;
  adminUser?: string;       // managed Caldera UI login
  adminPassword?: string;   // managed Caldera UI login (plaintext, for display)
}

export interface C2Provider {
  kind: C2Kind;
  displayName: string;
  docsUrl: string;
  available: boolean;       // false → shown as "Coming soon", not usable
  canDeploy: boolean;       // managed (platform-deployed) server supported
  health(server: C2Server): Promise<C2Health>;
  listAgents(server: C2Server): Promise<C2Beacon[]>;
  enrollmentCommand(server: C2Server, os: C2Os): string;
  runTechnique(
    server: C2Server,
    step: { techniqueId?: string; refId?: string; displayName?: string },
    timeoutMs: number,
  ): Promise<StepRunResult>;
  deploy?(opts: C2DeployOpts): Promise<C2DeployResult>;
}
