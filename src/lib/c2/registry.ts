/** C2 provider registry — the single place that knows the available frameworks. */

import type { C2Provider, C2Kind } from "./types";
import { calderaProvider } from "./providers/caldera";
import { sliverProvider } from "./providers/sliver";
import { openbasProvider } from "./providers/openbas";

const PROVIDERS: Record<C2Kind, C2Provider> = {
  caldera: calderaProvider,
  sliver: sliverProvider,
  openbas: openbasProvider,
};

export function getProvider(kind: string): C2Provider | null {
  return (PROVIDERS as Record<string, C2Provider>)[kind] || null;
}

/** Catalog for the Fleet Simulation "C2 options" cards. */
export function listProviders(): Array<Pick<C2Provider, "kind" | "displayName" | "docsUrl" | "available" | "canDeploy">> {
  return Object.values(PROVIDERS).map((p) => ({
    kind: p.kind, displayName: p.displayName, docsUrl: p.docsUrl, available: p.available, canDeploy: p.canDeploy,
  }));
}
