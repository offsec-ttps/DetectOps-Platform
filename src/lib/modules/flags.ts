/**
 * Feature flags for the Simulation Module marketplace (plugin architecture).
 *
 * Mirrors src/lib/community-sources/flags.ts. The master flag gates the whole
 * subsystem; per-feature flags let admins phase rollout of auto-approve and
 * signature enforcement independently.
 */

const truthy = (v: string | undefined, defaultValue = false) => {
  if (v === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

export const moduleFlags = {
  // Master switch for the whole module marketplace.
  marketplace:   truthy(process.env.ENABLE_MODULE_MARKETPLACE, true),
  // Allow the validation agent to flip approved → live without a human.
  autoApprove:   truthy(process.env.ENABLE_MODULE_AUTO_APPROVE, true),
  // Require a verified signature before a module may go live.
  signing:       truthy(process.env.ENABLE_MODULE_SIGNING, false),
};

export function isModuleFeatureEnabled(key: keyof typeof moduleFlags): boolean {
  if (!moduleFlags.marketplace) return false;
  return moduleFlags[key] === true;
}
