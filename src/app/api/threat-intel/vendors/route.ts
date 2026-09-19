import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Vendor catalog — the full list of supported third-party TI vendors
const VENDOR_CATALOG = [
  { name: "Threadlinqs", description: "AI-powered threat intelligence with enriched reports, detections (SPL/KQL/Sigma), IOCs, MITRE mappings, and remediation", apiUrl: "https://intel.threadlinqs.com/api/v1", authMethod: "api_key", category: "threat_intel" },
  { name: "SOC Prime", description: "Threat detection marketplace with SSO — community-driven Sigma, YARA, and vendor-native detection rules mapped to MITRE ATT&CK", apiUrl: "https://api.socprime.com/v1", authMethod: "sso", category: "detection_rules" },
  { name: "MISP", description: "Open-source threat intelligence sharing platform — events, attributes, galaxies, and STIX feeds", apiUrl: "https://your-misp-instance.local", authMethod: "api_key", category: "threat_intel" },
  { name: "OpenCTI", description: "Open-source cyber threat intelligence platform with STIX 2.1 graph database and connectors", apiUrl: "https://your-opencti-instance.local", authMethod: "token", category: "threat_intel" },
  { name: "Feedly", description: "AI-powered threat intel feed reader with CVE tracking, IoC extraction, and MITRE mapping", apiUrl: "https://api.feedly.com/v3", authMethod: "oauth", category: "feed_aggregator" },
  { name: "VirusTotal", description: "File, URL, domain, and IP reputation analysis with detection verdicts from 70+ AV engines", apiUrl: "https://www.virustotal.com/api/v3", authMethod: "api_key", category: "ioc_enrichment" },
  { name: "Shodan", description: "Internet-wide scanner for exposed services, vulnerabilities, and IoT devices", apiUrl: "https://api.shodan.io", authMethod: "api_key", category: "ioc_enrichment" },
  { name: "AlienVault OTX", description: "Open threat exchange with pulses, IoCs, and community-contributed threat intelligence", apiUrl: "https://otx.alienvault.com/api/v1", authMethod: "api_key", category: "threat_intel" },
  { name: "Abuse.ch", description: "Community-driven threat intelligence feeds — MalwareBazaar, URLhaus, ThreatFox, Feodo Tracker", apiUrl: "https://mb-api.abuse.ch/api/v1", authMethod: "api_key", category: "ioc_feeds" },
  { name: "GreyNoise", description: "Internet scanner context — distinguish targeted attacks from background noise", apiUrl: "https://api.greynoise.io/v3", authMethod: "api_key", category: "ioc_enrichment" },
  { name: "Censys", description: "Internet-wide scanning data for hosts, certificates, and services", apiUrl: "https://search.censys.io/api/v2", authMethod: "api_key", category: "ioc_enrichment" },
  { name: "Pulsedive", description: "Threat intelligence platform with IoC enrichment, risk scoring, and feed aggregation", apiUrl: "https://pulsedive.com/api", authMethod: "api_key", category: "ioc_enrichment" },
  { name: "CIRCL MISP", description: "CIRCL's public MISP instance with curated threat intelligence and OSINT feeds", apiUrl: "https://www.circl.lu/doc/misp/feed-osint", authMethod: "api_key", category: "threat_intel" },
  { name: "IntelOwl", description: "Open-source OSINT/TI analysis platform — analyze files, domains, IPs, and URLs", apiUrl: "https://your-intelowl.local/api", authMethod: "api_key", category: "analysis" },
  { name: "TheHive", description: "Open-source incident response platform with case management and MISP integration", apiUrl: "https://your-thehive.local/api", authMethod: "api_key", category: "incident_response" },
  { name: "MITRE ATT&CK", description: "Official MITRE ATT&CK knowledge base — techniques, tactics, groups, software, and mitigations", apiUrl: "https://raw.githubusercontent.com/mitre/cti/master", authMethod: "api_key", category: "framework" },
];

/** GET — list all vendors (from DB + catalog) */
export async function GET() {
  const dbVendors = await prisma.tiVendor.findMany({ orderBy: { name: "asc" } });
  const dbMap = new Map(dbVendors.map((v) => [v.name, v]));

  // Merge catalog with DB records
  const vendors = VENDOR_CATALOG.map((cat) => {
    const db = dbMap.get(cat.name);
    return {
      ...cat,
      id: db?.id || null,
      apiKey: db?.apiKey ? "••••••••" : "",
      clientId: db?.clientId || "",
      enabled: db?.enabled || false,
      connected: db?.connected || false,
      lastSyncAt: db?.lastSyncAt || null,
      lastError: db?.lastError || null,
      threatCount: db?.threatCount || 0,
      configured: !!db,
    };
  });

  return NextResponse.json({ items: vendors });
}

/** POST — configure/update a vendor */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, apiUrl, apiKey, authMethod, clientId, clientSecret, enabled } = body;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const existing = await prisma.tiVendor.findUnique({ where: { name } });
  if (existing) {
    const updated = await prisma.tiVendor.update({
      where: { name },
      data: {
        apiUrl: apiUrl ?? existing.apiUrl,
        apiKey: apiKey ?? existing.apiKey,
        authMethod: authMethod ?? existing.authMethod,
        clientId: clientId ?? existing.clientId,
        clientSecret: clientSecret ?? existing.clientSecret,
        enabled: enabled ?? existing.enabled,
      },
    });
    return NextResponse.json(updated);
  }

  const vendor = await prisma.tiVendor.create({
    data: {
      name,
      description: VENDOR_CATALOG.find((v) => v.name === name)?.description || "",
      apiUrl: apiUrl || VENDOR_CATALOG.find((v) => v.name === name)?.apiUrl || "",
      apiKey: apiKey || "",
      authMethod: authMethod || "api_key",
      clientId: clientId || "",
      clientSecret: clientSecret || "",
      enabled: enabled ?? true,
    },
  });
  return NextResponse.json(vendor, { status: 201 });
}
