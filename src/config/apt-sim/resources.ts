/**
 * Curated, referential open-source resources for the APT Simulation library,
 * taken verbatim from APT-Simulation-Lab-Resources.docx (Appendix A — Master
 * Link Index, tables 13–15). Every URL is the real upstream; descriptions are
 * the doc's. Purely referential — surfaced in the APT Simulation "Resources" tab
 * so analysts have the legit emulation / intel / lab sources at hand.
 */

export interface AptResource { name: string; description: string; url: string }
export interface AptResourceGroup { title: string; blurb: string; items: AptResource[] }

export const APT_RESOURCES: AptResourceGroup[] = [
  {
    title: "Emulation plan libraries",
    blurb: "Ready-made, intel-driven plans that replay a breach end-to-end.",
    items: [
      { name: "CTID Adversary Emulation Library", description: "MITRE Center for Threat-Informed Defense — 11 full, intel-driven emulation plans.", url: "https://github.com/center-for-threat-informed-defense/adversary_emulation_library" },
      { name: "ATT&CK Evaluations — ael", description: "The adversary plans used in the public ATT&CK Evaluations; realistic, multi-stage.", url: "https://github.com/attackevals/ael" },
      { name: "Caldera 'emu' plugin (CTID plans)", description: "CTID plans packaged to run automatically inside Caldera.", url: "https://github.com/mitre/emu" },
      { name: "SCYTHE community-threats", description: "Shared JSON 'threats' incl. #ThreatThursday emulations, mapped to ATT&CK.", url: "https://github.com/scythe-io/community-threats" },
    ],
  },
  {
    title: "Emulation & BAS tooling",
    blurb: "Execute the techniques: full chains, technique gaps, AD, cloud.",
    items: [
      { name: "MITRE Caldera", description: "Automated adversary-emulation framework; runs full chains (+ the 'emu' plugin).", url: "https://github.com/mitre/caldera" },
      { name: "Atomic Red Team", description: "Library of small, technique-level tests mapped to ATT&CK; chain them into an APT.", url: "https://github.com/redcanaryco/atomic-red-team" },
      { name: "Stratus Red Team", description: "'Atomic Red Team for the cloud' — real techniques for AWS/Azure/GCP/Kubernetes.", url: "https://github.com/DataDog/stratus-red-team" },
      { name: "PurpleSharp", description: "Adversary simulation for Windows AD — executes ATT&CK techniques to generate telemetry.", url: "https://github.com/mvelazc0/PurpleSharp" },
      { name: "APTSimulator", description: "Windows batch toolset that makes a host look compromised (fast, lightweight).", url: "https://github.com/NextronSystems/APTSimulator" },
      { name: "Infection Monkey", description: "Automated breach-and-attack simulation / lateral movement (Akamai/Guardicore).", url: "https://github.com/guardicore/monkey" },
      { name: "Red Team Automation (RTA)", description: "38+ Python scripts emulating malicious tradecraft, ATT&CK-aligned (Endgame).", url: "https://github.com/endgameinc/RTA" },
      { name: "Metta", description: "Uber's adversarial-simulation tool driven by YAML action files.", url: "https://github.com/uber-common/metta" },
      { name: "C2 Matrix", description: "Catalog comparing open-source & commercial C2 frameworks to pick one per plan.", url: "https://www.thec2matrix.com/" },
      { name: "VECTR", description: "Purple-team planning/tracking with ATT&CK Navigator + Atomic Red Team integration.", url: "https://github.com/SecurityRiskAdvisors/VECTR" },
    ],
  },
  {
    title: "Threat intelligence & TTP sources",
    blurb: "Pick targets, resolve aliases, extract the exact techniques to emulate.",
    items: [
      { name: "MITRE ATT&CK — Groups", description: "Authoritative group roster with aliases, targeted sectors & linked techniques/software.", url: "https://attack.mitre.org/groups/" },
      { name: "MITRE ATT&CK Navigator", description: "Layer each group's techniques to visualize & compare coverage.", url: "https://github.com/mitre-attack/attack-navigator" },
      { name: "ETDA/ThaiCERT Threat Group Cards", description: "Encyclopedia of actors with source country, target country/sector; JSON export.", url: "https://apt.etda.or.th/cgi-bin/aptgroups.cgi" },
      { name: "MISP Galaxy (threat-actor)", description: "Machine-readable actor clusters & aliases feeding MISP/TI pipelines.", url: "https://github.com/MISP/misp-galaxy" },
      { name: "Tidal Cyber (Community)", description: "Free knowledge base pivoting adversary TTPs against your defensive stack.", url: "https://app.tidalcyber.com/" },
      { name: "Malpedia (Fraunhofer FKIE)", description: "Curated malware families cross-linked to actors.", url: "https://malpedia.caad.fkie.fraunhofer.de/" },
      { name: "APTnotes", description: "Chronological archive of public APT reports (CSV/JSON index).", url: "https://github.com/aptnotes/data" },
      { name: "CyberMonitor APT & Cybercriminal Collections", description: "Mega-archive of APT/cybercrime campaign reports by year.", url: "https://github.com/CyberMonitor/APT_CyberCriminal_Campagin_Collections" },
      { name: "Unit 42 Playbook Viewer", description: "Per-adversary TTP playbooks (Palo Alto Networks).", url: "https://pan-unit42.github.io/playbook_viewer/" },
      { name: "The DFIR Report", description: "Detailed real-intrusion write-ups with TTPs, timelines & detections.", url: "https://thedfirreport.com/" },
      { name: "Mandiant / Google APT groups", description: "APT# and FIN# naming source with attribution.", url: "https://cloud.google.com/security/resources/insights/apt-groups" },
      { name: "CrowdStrike Adversary Universe", description: "'Animal' naming (Panda/Bear/Kitten/Chollima) + profiles.", url: "https://www.crowdstrike.com/en-us/adversaries/" },
      { name: "Microsoft Threat-Actor Naming", description: "Weather-system naming (Typhoon/Blizzard/Sandstorm/Sleet) cross-reference.", url: "https://learn.microsoft.com/en-us/unified-secops-platform/microsoft-threat-actor-naming" },
      { name: "CISA Cybersecurity Advisories", description: "Government TTP advisories (esp. ICS/critical infra & #StopRansomware).", url: "https://www.cisa.gov/news-events/cybersecurity-advisories" },
      { name: "vx-underground", description: "Large malware-sample & paper archive (handle with care, isolated).", url: "https://vx-underground.org/" },
    ],
  },
  {
    title: "Lab infrastructure, telemetry & detections",
    blurb: "Stand up the instrumented range, generate logs, detect what you emulate.",
    items: [
      { name: "GOAD (Game of Active Directory)", description: "Intentionally vulnerable multi-domain AD lab for realistic attack paths.", url: "https://github.com/Orange-Cyberdefense/GOAD" },
      { name: "Splunk Attack Range", description: "Splunk STRT range: instrumented envs, runs Atomic/Caldera, ships telemetry to Splunk.", url: "https://github.com/splunk/attack_range" },
      { name: "DetectionLab", description: "Pre-instrumented Windows domain (Sysmon + Olaf config, Zeek, Suricata, Splunk).", url: "https://github.com/clong/DetectionLab" },
      { name: "Ludus", description: "Deploy whole VM ranges (incl. GOAD) from one YAML on Proxmox/Ansible.", url: "https://ludus.cloud/" },
      { name: "OTRF Security-Datasets (Mordor)", description: "Pre-recorded attack telemetry mapped to ATT&CK — validate detections offline.", url: "https://github.com/OTRF/Security-Datasets" },
      { name: "OTRF ThreatHunter-Playbook", description: "Analytics & hunting notebooks tied to ATT&CK data sources.", url: "https://github.com/OTRF/ThreatHunter-Playbook" },
      { name: "olafhartong/sysmon-modular", description: "Modular, ATT&CK-tagged Sysmon config for high-fidelity endpoint telemetry.", url: "https://github.com/olafhartong/sysmon-modular" },
      { name: "SigmaHQ (Sigma rules)", description: "Vendor-neutral detection rules — convert to your SIEM to detect emulated TTPs.", url: "https://github.com/SigmaHQ/sigma" },
      { name: "Elastic detection-rules", description: "Elastic's open detection ruleset, ATT&CK-mapped.", url: "https://github.com/elastic/detection-rules" },
      { name: "Splunk security_content", description: "Splunk ESCU detections + analytic stories, aligned to Attack Range.", url: "https://github.com/splunk/security_content" },
    ],
  },
];

/** Per-group external references, built from the group's own identifiers. Only
 *  returns links we can construct legitimately (ATT&CK group page from its G-id;
 *  ETDA/MISP search by name). */
export function groupReferences(group: { name: string; mitreId?: string }): AptResource[] {
  const refs: AptResource[] = [];
  if (group.mitreId && /^G\d{4}$/.test(group.mitreId)) {
    refs.push({ name: `MITRE ATT&CK — ${group.mitreId}`, description: "Authoritative group page: aliases, techniques, software.", url: `https://attack.mitre.org/groups/${group.mitreId}/` });
  }
  const q = encodeURIComponent(group.name);
  refs.push({ name: "ETDA Threat Group Cards", description: "ThaiCERT actor encyclopedia (origin, targets).", url: `https://apt.etda.or.th/cgi-bin/aptsearch.cgi?q=${q}` });
  refs.push({ name: "MISP Galaxy", description: "Machine-readable actor cluster & aliases.", url: "https://github.com/MISP/misp-galaxy/blob/main/clusters/threat-actor.json" });
  refs.push({ name: "Malpedia", description: "Malware families cross-linked to this actor.", url: `https://malpedia.caad.fkie.fraunhofer.de/actor/${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` });
  return refs;
}
