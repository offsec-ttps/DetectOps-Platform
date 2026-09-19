import { NextResponse } from "next/server";

const detections = [
  {
    id: "9e1a7f2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
    name: "LSASS Memory Dump via comsvcs.dll",
    description: "Detects usage of comsvcs.dll to dump LSASS process memory for credential access",
    status: "active",
    severity: "critical",
    technique: "T1003.001",
    tactic: "Credential Access",
    logSource: { product: "windows", service: "sysmon", category: "process_creation" },
    author: "Detection Engineer",
    reliability: 0.91,
    lastTested: "2026-03-26T14:30:00Z",
    createdAt: "2025-01-15T10:00:00Z",
    updatedAt: "2026-02-20T16:45:00Z",
  },
  {
    id: "a2b3c4d5-e6f7-8a9b-0c1d-2e3f4a5b6c7d",
    name: "Suspicious PowerShell Execution",
    description: "Detects suspicious PowerShell download cradles and encoded commands",
    status: "active",
    severity: "high",
    technique: "T1059.001",
    tactic: "Execution",
    logSource: { product: "windows", service: "powershell", category: "ps_script" },
    author: "Threat Hunter",
    reliability: 0.87,
    lastTested: "2026-03-23T09:15:00Z",
    createdAt: "2025-03-10T11:00:00Z",
    updatedAt: "2026-03-15T14:20:00Z",
  },
];

export async function GET() {
  return NextResponse.json({ detections, total: detections.length });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json(
    { message: "Detection rule created", id: crypto.randomUUID(), ...body },
    { status: 201 }
  );
}
