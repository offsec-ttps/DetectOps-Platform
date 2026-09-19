import { NextResponse } from "next/server";

const assets = [
  { id: "asset-001", name: "AD Domain Controller", type: "server", criticality: "critical", techniqueMappings: 6, coverage: 0.83 },
  { id: "asset-002", name: "Exchange Server", type: "server", criticality: "high", techniqueMappings: 5, coverage: 0.60 },
  { id: "asset-003", name: "Windows 10 Endpoints", type: "endpoint", criticality: "high", techniqueMappings: 8, coverage: 0.75 },
  { id: "asset-004", name: "Azure AD", type: "cloud_workload", criticality: "critical", techniqueMappings: 4, coverage: 0.50 },
  { id: "asset-005", name: "AWS Production VPC", type: "cloud_workload", criticality: "high", techniqueMappings: 5, coverage: 0.40 },
];

const threatModels = [
  {
    id: "tm-001",
    name: "APT29 Targeting Corporate Network",
    priority: "critical",
    assets: ["asset-001", "asset-002", "asset-003", "asset-004"],
    attackPath: [
      { step: 1, technique: "T1566.001", name: "Spearphishing Attachment", covered: true },
      { step: 2, technique: "T1059.001", name: "PowerShell Execution", covered: true },
      { step: 3, technique: "T1003.001", name: "LSASS Dump", covered: true },
      { step: 4, technique: "T1021.001", name: "RDP Lateral Movement", covered: true },
      { step: 5, technique: "T1048", name: "Exfiltration via DNS", covered: false },
    ],
    coverage: 0.80,
  },
  {
    id: "tm-002",
    name: "Ransomware Attack Path",
    priority: "high",
    assets: ["asset-001", "asset-003"],
    attackPath: [
      { step: 1, technique: "T1190", name: "Exploit Public-Facing App", covered: false },
      { step: 2, technique: "T1053.005", name: "Scheduled Task", covered: true },
      { step: 3, technique: "T1547.001", name: "Registry Persistence", covered: true },
      { step: 4, technique: "T1082", name: "System Discovery", covered: false },
      { step: 5, technique: "T1486", name: "Data Encrypted for Impact", covered: false },
    ],
    coverage: 0.40,
  },
];

export async function GET() {
  return NextResponse.json({ assets, threatModels });
}
