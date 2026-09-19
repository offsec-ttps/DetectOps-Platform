/** OpenBAS / OpenAEV C2 provider — placeholder (Coming soon). Not usable yet. */

import type { C2Provider } from "../types";

export const openbasProvider: C2Provider = {
  kind: "openbas",
  displayName: "OpenBAS (OpenAEV)",
  docsUrl: "https://docs.openaev.io/",
  available: false,
  canDeploy: false,
  health: async () => ({ ok: false, error: "OpenBAS provider is not available yet" }),
  listAgents: async () => [],
  enrollmentCommand: () => "# OpenBAS enrollment is not available yet",
  runTechnique: async () => ({ status: "stubbed", exitCode: -1, stdout: "", stderr: "", durationMs: 0, notes: "OpenBAS provider not available yet" }),
};
