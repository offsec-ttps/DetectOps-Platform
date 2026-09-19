/**
 * Platform deployment mode — decides whether the "Local Lab" (VirtualBox/Vagrant
 * on the platform host) option is offered.
 *
 *   - self-hosted (default / dev): the platform runs on the operator's own host,
 *     so local VM deployment is meaningful → Local Lab card shown.
 *   - cloud (set PLATFORM_MODE=cloud): a hosted multi-tenant SaaS, where labs go
 *     into the USER's cloud and the fleet runs on the user's endpoints → Local
 *     Lab card hidden (it would deploy VMs on the shared SaaS host).
 */

export type PlatformMode = "self-hosted" | "cloud";

export function platformMode(): PlatformMode {
  return process.env.PLATFORM_MODE === "cloud" ? "cloud" : "self-hosted";
}

/** Whether the Local (on-host VirtualBox) deploy path should be offered. */
export function localDeployAvailable(): boolean {
  return platformMode() === "self-hosted";
}
