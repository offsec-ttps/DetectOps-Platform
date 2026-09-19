import { NextResponse } from "next/server";

const metrics = {
  current: {
    mttd: 4.2,
    mtti: 35,
    coverage: 0.67,
    avgReliability: 0.82,
    totalRules: 12,
    activeRules: 8,
    totalTests: 32,
    successfulTests: 28,
  },
  trends: [
    { month: "2025-10", mttd: 8.5, mtti: 72, coverage: 0.42, rules: 6 },
    { month: "2025-11", mttd: 7.2, mtti: 65, coverage: 0.48, rules: 7 },
    { month: "2025-12", mttd: 6.1, mtti: 58, coverage: 0.52, rules: 8 },
    { month: "2026-01", mttd: 5.3, mtti: 48, coverage: 0.58, rules: 9 },
    { month: "2026-02", mttd: 4.8, mtti: 40, coverage: 0.62, rules: 10 },
    { month: "2026-03", mttd: 4.2, mtti: 35, coverage: 0.67, rules: 12 },
  ],
  coverageMatrix: {
    "Initial Access": { T1566_001: 0.9, T1190: 0 },
    Execution: { T1059_001: 0.87, T1059_003: 0.4 },
    Persistence: { T1547_001: 0.82, T1053_005: 0.5 },
    "Credential Access": { T1003_001: 0.91 },
    "Lateral Movement": { T1021_001: 0.75 },
    Exfiltration: { T1048: 0.35 },
    Impact: { T1486: 0 },
  },
  detectionDebt: {
    staleRules: 2,
    untestedRules: 3,
    noisyRules: 1,
    missingCoverage: 4,
  },
};

export async function GET() {
  return NextResponse.json(metrics);
}
