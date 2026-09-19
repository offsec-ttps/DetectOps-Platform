/**
 * GET /api/modules/template — a starter module.json the author can download,
 * fill in offline, and upload via POST /api/modules. Also used to seed the
 * in-app builder playground.
 */

import { NextResponse } from "next/server";
import { CORE_VERSION } from "@/lib/modules/core-version";

export async function GET() {
  const template = {
    manifest: {
      id: "yourname.my-simulation",
      name: "My Simulation",
      version: "1.0.0",
      category: "ransomware",
      description: "What this module simulates and why.",
      author: "Your Name / Team",
      icon: "ShieldAlert",
      compatibleCoreVersion: `^${CORE_VERSION}`,
      permissions: {
        // Only the runner frameworks your steps actually use.
        frameworks: ["atomic"],
        // SIEM/EDR integrations this module needs for detection scoring (optional).
        integrations: [],
        dataScopes: ["atomic-catalogue:read"],
      },
      dependencies: [],
      contributes: {
        nav: [{ label: "My Simulation", icon: "ShieldAlert" }],
        scenarios: [
          {
            name: "Example scenario",
            description: "Orchestrates curated Atomic Red Team tests.",
            steps: [
              {
                framework: "atomic",
                // refId MUST be an existing AtomicTest testGuid (find one in the
                // Atomic Test Library). Modules can only orchestrate curated tests.
                refId: "REPLACE-with-a-real-AtomicTest-testGuid",
                techniqueId: "T1059.001",
                displayName: "Describe this step",
              },
            ],
          },
        ],
      },
    },
  };
  return new NextResponse(JSON.stringify(template, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="module.json"',
    },
  });
}
