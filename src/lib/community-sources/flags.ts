/**
 * Feature flags for the Community Content expansion.
 *
 * If `ENABLE_COMMUNITY_CONTENT_EXPANSION` is false, every new source returns
 * `enabled=false` and the platform behaves exactly as it does today
 * (only SigmaHQ + Elastic + Splunk + Atomic visible).
 *
 * Per-source flags let admins enable/disable each new source individually
 * during phased rollout.
 */

const truthy = (v: string | undefined, defaultValue = false) => {
  if (v === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

export const flags = {
  // Master kill-switch for everything in this expansion
  expansion:        truthy(process.env.ENABLE_COMMUNITY_CONTENT_EXPANSION, true),

  // Sigma CLI / pySigma conversion in Rule Workspace
  sigmaConversion:  truthy(process.env.ENABLE_SIGMA_WORKSPACE_CONVERSION, true),

  // Per-source flags (Phase 2-4) — all default ON now that adapters are implemented
  mitreCar:         truthy(process.env.ENABLE_MITRE_CAR_SOURCE, true),
  sentinel:         truthy(process.env.ENABLE_MICROSOFT_SENTINEL_SOURCE, true),
  defenderXdr:      truthy(process.env.ENABLE_DEFENDER_XDR_SOURCE, true),
  googleSecops:     truthy(process.env.ENABLE_GOOGLE_SECOPS_SOURCE, true),
  panther:          truthy(process.env.ENABLE_PANTHER_SOURCE, true),
  falco:            truthy(process.env.ENABLE_FALCO_SOURCE, true),
  wazuh:            truthy(process.env.ENABLE_WAZUH_SOURCE, true),
};

/** Returns true only if BOTH the master flag and the source flag are on. */
export function isSourceEnabled(key: keyof typeof flags): boolean {
  if (!flags.expansion) return false;
  return flags[key] === true;
}
