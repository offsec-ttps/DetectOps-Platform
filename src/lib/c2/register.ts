/**
 * Bridge a C2Server into the existing simulation pipeline: upsert a backing
 * EnvironmentTarget(kind="agent", agentBackend="caldera") so the enterprise
 * use-case runner (dispatchStep → runCaldera) and Campaign Designer can target
 * the C2 with no further wiring. Idempotent by EnvironmentTarget.name.
 *
 * The Caldera API key is stored ONCE on the C2Server (apiKeyEnc); we copy the
 * already-encrypted blob straight across, so the plaintext key never re-enters
 * this layer.
 */

import { prisma } from "@/lib/prisma";
import type { C2Server } from "@/generated/prisma/client";

/** Only Caldera currently maps onto the EnvironmentTarget agent backend. */
export async function registerC2AsEnvironmentTarget(server: C2Server): Promise<string | null> {
  if (server.provider !== "caldera") return null;

  const name = `C2: ${server.name}`;
  const data = {
    kind: "agent",
    agentBackend: "caldera",
    calderaUrl: server.url,
    calderaApiKeyEnc: server.apiKeyEnc,     // already AES-GCM encrypted on the C2Server
    calderaGroup: server.group || "red",
    agentPlatform: server.agentPlatform || "",
    description: `Auto-registered from Fleet Simulation C2 "${server.name}" (${server.mode})`,
    ownerId: server.ownerId || "",
    enabled: true,
  };
  const env = await prisma.environmentTarget.upsert({
    where: { name },
    create: { name, ...data },
    update: data,
  });
  return env.id;
}

/** Remove the backing EnvironmentTarget when a C2Server is deleted. */
export async function unregisterC2EnvironmentTarget(environmentTargetId: string | null | undefined): Promise<void> {
  if (!environmentTargetId) return;
  await prisma.environmentTarget.delete({ where: { id: environmentTargetId } }).catch(() => {});
}
