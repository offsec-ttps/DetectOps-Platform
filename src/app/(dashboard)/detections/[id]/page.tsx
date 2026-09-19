"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Shield,
  Clock,
  User,
  Calendar,
  Tag,
  ExternalLink,
  CheckCircle,
  XCircle,
  Play,
  Pencil,
  Rocket,
  Archive,
  Activity,
  FlaskConical,
  FileText,
  Link2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

const sigmaYaml = `title: LSASS Memory Dump via comsvcs.dll
id: 9e1a7f2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b
status: active
level: critical
description: |
    Detects usage of comsvcs.dll to dump LSASS process
    memory for credential access.
references:
    - https://lolbas-project.github.io/lolbas/Libraries/Comsvcs/
    - https://attack.mitre.org/techniques/T1003/001/
author: DetectOps Platform
date: 2025/01/15
modified: 2026/02/20
tags:
    - attack.credential_access
    - attack.t1003.001
logsource:
    category: process_creation
    product: windows
detection:
    selection_img:
        Image|endswith: '\\\\rundll32.exe'
    selection_cli:
        CommandLine|contains|all:
            - 'comsvcs'
            - 'MiniDump'
    condition: selection_img and selection_cli
falsepositives:
    - Legitimate use of comsvcs.dll for debugging
level: critical`;

const splQuery = `index=win sourcetype="XmlWinEventLog:Microsoft-Windows-Sysmon/Operational"
    EventCode=1
    Image="*\\\\rundll32.exe"
    CommandLine="*comsvcs*MiniDump*"
| stats count by _time, Computer, User, ParentImage, CommandLine
| sort -_time`;

const kqlQuery = `DeviceProcessEvents
| where FileName =~ "rundll32.exe"
| where ProcessCommandLine has_all ("comsvcs", "MiniDump")
| project Timestamp, DeviceName, AccountName,
    ProcessCommandLine, InitiatingProcessFileName
| sort by Timestamp desc`;

const testRuns = [
  { date: "2026-03-26", framework: "ART", lab: "Splunk Attack Range", status: "success", duration: "45s" },
  { date: "2026-03-18", framework: "ART", lab: "Splunk Attack Range", status: "success", duration: "42s" },
  { date: "2026-02-28", framework: "CALDERA", lab: "Splunk Attack Range", status: "success", duration: "3m 12s" },
  { date: "2026-02-10", framework: "ART", lab: "Replay Range", status: "failure", duration: "38s" },
];

export default function DetectionDetailPage() {
  const [tab, setTab] = useState<"overview" | "logic" | "tests">("overview");

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back link */}
      <Link href="/detections" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Detections
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">LSASS Memory Dump via comsvcs.dll</h1>
            <span className="rounded-full border bg-severity-critical/15 text-severity-critical border-severity-critical/30 px-2.5 py-0.5 text-xs font-semibold">critical</span>
            <span className="rounded-full border bg-status-active/15 text-status-active border-status-active/30 px-2.5 py-0.5 text-xs font-semibold">active</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-mono font-bold text-accent">T1003.001</span>
            <span className="text-xs text-muted">Credential Access &middot; LSASS Memory</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main content */}
        <div className="col-span-8">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-border mb-6">
            {(["overview", "logic", "tests"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize", tab === t ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground")}>
                {t === "logic" ? "Rule Logic" : t === "tests" ? "Test Results" : "Overview"}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {tab === "overview" && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Detects usage of comsvcs.dll to dump LSASS process memory, a common credential access technique used by APT groups (notably APT29) and red teams. The rule monitors for rundll32.exe executing comsvcs.dll with the MiniDump function, which creates a memory dump of the LSASS process.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: User, label: "Author", value: "Detection Engineer" },
                  { icon: Calendar, label: "Created", value: "Jan 15, 2025" },
                  { icon: Calendar, label: "Updated", value: "Feb 20, 2026" },
                  { icon: Activity, label: "Lifecycle Phase", value: "Continuous Tuning" },
                  { icon: Shield, label: "Log Source", value: "windows / sysmon / process_creation" },
                  { icon: Clock, label: "Last Tested", value: "Mar 26, 2026 (2 days ago)" },
                ].map((m) => (
                  <div key={m.label} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <m.icon className="h-4 w-4 text-muted shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted uppercase tracking-wider">{m.label}</p>
                      <p className="text-sm text-foreground">{m.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
                <h3 className="text-sm font-semibold text-foreground mb-2">MITRE ATT&CK Mapping</h3>
                <div className="flex items-center gap-4">
                  <div><p className="text-[10px] text-muted">Tactic</p><p className="text-sm text-accent font-medium">TA0006 — Credential Access</p></div>
                  <ArrowLeft className="h-4 w-4 text-muted rotate-180" />
                  <div><p className="text-[10px] text-muted">Technique</p><p className="text-sm text-accent font-medium">T1003 — OS Credential Dumping</p></div>
                  <ArrowLeft className="h-4 w-4 text-muted rotate-180" />
                  <div><p className="text-[10px] text-muted">Sub-Technique</p><p className="text-sm text-accent font-medium">T1003.001 — LSASS Memory</p></div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">False Positives</h3>
                <ul className="space-y-1">
                  <li className="flex items-start gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />Legitimate use of comsvcs.dll for application debugging</li>
                  <li className="flex items-start gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />Software developers testing crash dump functionality</li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">References</h3>
                <ul className="space-y-1">
                  <li><a href="#" className="flex items-center gap-1 text-sm text-accent hover:underline"><ExternalLink className="h-3 w-3" />LOLBAS Project — Comsvcs.dll</a></li>
                  <li><a href="#" className="flex items-center gap-1 text-sm text-accent hover:underline"><ExternalLink className="h-3 w-3" />MITRE ATT&CK T1003.001</a></li>
                </ul>
              </div>
            </div>
          )}

          {/* Rule Logic Tab */}
          {tab === "logic" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Sigma Rule (YAML)</h3>
                <div className="rounded-lg border border-border bg-[#0d1117] overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border bg-[#161b22] px-4 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">SIGMA / YAML</span>
                  </div>
                  <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed font-mono text-muted-foreground">{sigmaYaml}</pre>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Splunk SPL</h3>
                <div className="rounded-lg border border-border bg-[#0d1117] overflow-hidden">
                  <div className="border-b border-border bg-[#161b22] px-4 py-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">SPL</span></div>
                  <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed font-mono text-muted-foreground">{splQuery}</pre>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Microsoft Defender KQL</h3>
                <div className="rounded-lg border border-border bg-[#0d1117] overflow-hidden">
                  <div className="border-b border-border bg-[#161b22] px-4 py-2"><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">KQL</span></div>
                  <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed font-mono text-muted-foreground">{kqlQuery}</pre>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Validation Status</h3>
                <div className="flex items-center gap-6">
                  {[
                    { label: "YAML Lint", pass: true },
                    { label: "Schema Validation", pass: true },
                    { label: "Unit Tests", pass: true, detail: "3/3 passed" },
                  ].map((v) => (
                    <div key={v.label} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-success" />
                      <span className="text-sm text-foreground">{v.label}</span>
                      {v.detail && <span className="text-xs text-muted">({v.detail})</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Test Results Tab */}
          {tab === "tests" && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-card-hover">
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Date</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Framework</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Lab</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Status</th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {testRuns.map((run, i) => (
                    <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-3 text-sm text-foreground">{run.date}</td>
                      <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", run.framework === "ART" ? "bg-accent/15 text-accent" : "bg-purple/15 text-purple")}>{run.framework}</span></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{run.lab}</td>
                      <td className="px-4 py-3">
                        <span className={cn("flex items-center gap-1 text-xs font-medium", run.status === "success" ? "text-success" : "text-danger")}>
                          {run.status === "success" ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{run.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="col-span-4 space-y-4">
          {/* Quick stats */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Quick Stats</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted">Reliability (Rd)</span>
                <span className="text-lg font-bold text-success">0.91</span>
              </div>
              <div className="text-[10px] text-muted space-y-0.5">
                <div className="flex justify-between"><span>P(Data)</span><span>0.95</span></div>
                <div className="flex justify-between"><span>P(Logic)</span><span>0.98</span></div>
                <div className="flex justify-between"><span>P(Ingest)</span><span>0.98</span></div>
              </div>
              <div className="border-t border-border pt-2 space-y-1">
                <div className="flex justify-between text-xs"><span className="text-muted">Times Tested</span><span className="text-foreground font-medium">8</span></div>
                <div className="flex justify-between text-xs"><span className="text-muted">Last Tested</span><span className="text-foreground font-medium">2 days ago</span></div>
              </div>
            </div>
          </div>

          {/* Use Cases */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Linked Use Cases</h3>
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-medium text-accent">Credential Access Monitoring</p>
              <p className="text-xs text-muted mt-0.5">Complete · Rd 0.91</p>
            </div>
          </div>

          {/* Related Rules */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Related Rules</h3>
            <div className="space-y-2">
              {["Suspicious PowerShell Execution", "Process Injection via CreateRemoteThread"].map((name) => (
                <div key={name} className="rounded-lg border border-border bg-background p-2">
                  <p className="text-xs font-medium text-foreground">{name}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Emulation Tests */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Emulation Tests</h3>
            <div className="rounded-lg border border-border bg-background p-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-3.5 w-3.5 text-accent" />
                <p className="text-xs font-medium text-foreground">ART T1003.001 — LSASS Dump via comsvcs.dll</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
              <Play className="h-4 w-4" /> Run Test
            </button>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
              <Pencil className="h-4 w-4" /> Edit Rule
            </button>
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card transition-colors">
              <Rocket className="h-4 w-4" /> Deploy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
