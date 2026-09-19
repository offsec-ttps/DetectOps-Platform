/**
 * The platform "core" version a module declares compatibility against
 * (manifest.compatibleCoreVersion is a semver range checked against this).
 * Override with CORE_VERSION env; otherwise the build-time constant.
 */
export const CORE_VERSION = process.env.CORE_VERSION || "1.0.0";
