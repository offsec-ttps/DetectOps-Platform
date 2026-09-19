import { NextResponse } from "next/server";

const testRuns = [
  {
    id: "tr-001",
    ruleId: "9e1a7f2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
    ruleName: "LSASS Memory Dump via comsvcs.dll",
    framework: "ART",
    technique: "T1003.001",
    labId: "lab-001",
    labName: "Splunk Attack Range - AWS",
    status: "success",
    startedAt: "2026-03-28T08:30:00Z",
    completedAt: "2026-03-28T08:30:45Z",
    duration: "45s",
    result: {
      telemetryCollected: true,
      eventsGenerated: 3,
      alertsFired: 1,
      detectionConfirmed: true,
    },
  },
  {
    id: "tr-002",
    ruleId: "a2b3c4d5-e6f7-8a9b-0c1d-2e3f4a5b6c7d",
    ruleName: "Suspicious PowerShell Execution",
    framework: "ART",
    technique: "T1059.001",
    labId: "lab-001",
    labName: "Splunk Attack Range - AWS",
    status: "success",
    startedAt: "2026-03-28T05:15:00Z",
    completedAt: "2026-03-28T05:15:32Z",
    duration: "32s",
    result: {
      telemetryCollected: true,
      eventsGenerated: 5,
      alertsFired: 2,
      detectionConfirmed: true,
    },
  },
];

const labEnvironments = [
  {
    id: "lab-001",
    name: "Splunk Attack Range - AWS",
    type: "live",
    provider: "AWS (Terraform)",
    status: "online",
    components: ["Splunk Server", "2x Windows Targets", "Linux Target", "Kali Attacker"],
    lastActive: "2026-03-28T08:30:45Z",
    costPerHour: 2.4,
  },
  {
    id: "lab-002",
    name: "Replay Range - Local",
    type: "replay",
    provider: "Local Docker",
    status: "ready",
    components: ["Splunk Docker", "Attack Data Replayer"],
    datasets: 15,
    lastActive: "2026-03-27T14:00:00Z",
    costPerHour: 0,
  },
];

export async function GET() {
  return NextResponse.json({ testRuns, labEnvironments });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json(
    { message: "Test run initiated", id: crypto.randomUUID(), status: "pending", ...body },
    { status: 201 }
  );
}
