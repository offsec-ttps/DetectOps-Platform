/**
 * GET /api/community/registry
 *
 * Returns the unified registry of all community sources (legacy + new).
 * Used by the Community Content section to render the source list with
 * a single fetch and to know which sources are enabled by feature flag.
 */

import { NextResponse } from "next/server";
import { getRegistryStatus } from "@/lib/community-sources/registry";
import { flags } from "@/lib/community-sources/flags";

export async function GET() {
  try {
    const sources = await getRegistryStatus();
    return NextResponse.json({
      flags: {
        expansion: flags.expansion,
        sigmaConversion: flags.sigmaConversion,
        mitreCar: flags.mitreCar,
        sentinel: flags.sentinel,
        defenderXdr: flags.defenderXdr,
        googleSecops: flags.googleSecops,
        panther: flags.panther,
        falco: flags.falco,
        wazuh: flags.wazuh,
      },
      sources,
      legacyCount: sources.filter((s) => ["sigmahq", "elastic", "splunk"].includes(s.id)).length,
      newCount: sources.filter((s) => !["sigmahq", "elastic", "splunk"].includes(s.id)).length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
