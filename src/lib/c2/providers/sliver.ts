/** Sliver C2 provider — placeholder (Coming soon). Not usable yet. */

import type { C2Provider } from "../types";

const notReady = async () => { throw new Error("Sliver provider is not available yet"); };

export const sliverProvider: C2Provider = {
  kind: "sliver",
  displayName: "Sliver",
  docsUrl: "https://sliver.sh/",
  available: false,
  canDeploy: false,
  health: async () => ({ ok: false, error: "Sliver provider is not available yet" }),
  listAgents: async () => [],
  enrollmentCommand: () => "# Sliver enrollment is not available yet",
  runTechnique: async () => ({ status: "stubbed", exitCode: -1, stdout: "", stderr: "", durationMs: 0, notes: "Sliver provider not available yet" }),
  deploy: notReady,
};
