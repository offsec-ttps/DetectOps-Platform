/**
 * Feature flags for the self-hosted ransomware-intel subsystem.
 * Master switch + per-collector flags. Tor collector is OFF by default (needs a
 * Tor SOCKS proxy + headless browser that production must provide).
 */

const truthy = (v: string | undefined, dflt = false) => {
  if (v === undefined) return dflt;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

export const intelFlags = {
  enabled:        truthy(process.env.ENABLE_RANSOMWARE_INTEL, true),
  ransomwatch:    truthy(process.env.ENABLE_COLLECTOR_RANSOMWATCH, true),
  ransomwareLive: truthy(process.env.ENABLE_COLLECTOR_RANSOMWARE_LIVE, true),
  tor:            truthy(process.env.ENABLE_TOR_COLLECTOR, false),
};

export function isIntelEnabled(): boolean { return intelFlags.enabled; }
export function isCollectorEnabled(key: "ransomwatch" | "ransomwareLive" | "tor"): boolean {
  return intelFlags.enabled && intelFlags[key] === true;
}
