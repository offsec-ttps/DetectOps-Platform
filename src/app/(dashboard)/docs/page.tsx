"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  FileText, RefreshCw, Loader2, BookOpen, Code2, GitBranch, Database,
  Activity, Layers, ArrowRight, Shield, Cpu, Network, CheckCircle,
  Box, BarChart3, Workflow,
} from "lucide-react";

interface Stats {
  pages: number;
  apiEndpoints: number;
  components: number;
  types: number;
  dataFlows: number;
  dependencies: number;
}

interface RouteInfo {
  path: string;
  filePath: string;
  type: string;
  methods?: string[];
  isDynamic: boolean;
}

interface APIEndpoint {
  route: string;
  method: string;
  filePath: string;
  description: string;
  queryParams?: string[];
}

interface ComponentInfo {
  name: string;
  filePath: string;
  category: string;
  exports: string[];
}

interface DataFlowEdge {
  from: string;
  to: string;
  label: string;
}

interface AnalysisResponse {
  timestamp: string;
  stats: Stats;
  routes: RouteInfo[];
  apiEndpoints: APIEndpoint[];
  components: ComponentInfo[];
  dataFlows: DataFlowEdge[];
}

const tabs = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "architecture", label: "Architecture", icon: Layers },
  { id: "api", label: "API Reference", icon: Code2 },
  { id: "routes", label: "Routes", icon: GitBranch },
  { id: "flows", label: "Data Flows", icon: Workflow },
  { id: "services", label: "Services", icon: Network },
  { id: "components", label: "Components", icon: Box },
] as const;

type TabId = (typeof tabs)[number]["id"];

function MermaidDiagram({ chart, id }: { chart: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            primaryColor: "#3b82f6",
            primaryTextColor: "#e2e8f0",
            primaryBorderColor: "#1e293b",
            lineColor: "#475569",
            secondaryColor: "#111827",
            tertiaryColor: "#1a2236",
            background: "#0a0e1a",
            mainBkg: "#111827",
            nodeBorder: "#1e293b",
            clusterBkg: "#111827",
            clusterBorder: "#1e293b",
            titleColor: "#e2e8f0",
            edgeLabelBackground: "#111827",
            nodeTextColor: "#e2e8f0",
          },
          flowchart: { curve: "basis", padding: 15 },
          securityLevel: "loose",
        });
        if (cancelled || !ref.current) return;
        const { svg } = await mermaid.render(`mermaid-${id}`, chart);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = `<pre class="text-xs text-danger p-4">${err}</pre>`;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [chart, id]);

  return (
    <div
      ref={ref}
      className="rounded-xl border border-border bg-card p-4 overflow-auto [&_svg]:max-w-full"
    />
  );
}

const methodColors: Record<string, string> = {
  GET: "bg-success/15 text-success",
  POST: "bg-accent/15 text-accent",
  PUT: "bg-warning/15 text-warning",
  PATCH: "bg-purple/15 text-purple",
  DELETE: "bg-danger/15 text-danger",
};

export default function DocsPage() {
  const [tab, setTab] = useState<TabId>("overview");
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<string | null>(null);

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/docs/generate");
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAnalysis(); }, [fetchAnalysis]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenResult(null);
    try {
      const res = await fetch("/api/docs/generate", { method: "POST" });
      const result = await res.json();
      if (result.status === "completed") {
        setRegenResult(`Regenerated ${result.filesGenerated.length} docs — ${result.stats.pages} pages, ${result.stats.apiEndpoints} APIs, ${result.stats.components} components`);
        fetchAnalysis();
      } else {
        setRegenResult(`Failed: ${result.error}`);
      }
    } catch (err) {
      setRegenResult(`Error: ${err}`);
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 animate-fade-in">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Platform Documentation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-generated architecture, API reference, data flows, and service maps
            {data && <> — last analyzed {new Date(data.timestamp).toLocaleString()}</>}
          </p>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {regenerating ? "Regenerating…" : "Regenerate Docs"}
        </button>
      </div>

      {regenResult && (
        <div className={cn("rounded-lg border p-3 text-sm", regenResult.includes("Failed") || regenResult.includes("Error") ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success")}>
          <CheckCircle className="inline h-4 w-4 mr-1.5" />{regenResult}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap", tab === t.id ? "text-accent border-accent" : "text-muted border-transparent hover:text-foreground")}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-6 gap-4">
            {[
              { label: "Pages", value: data.stats.pages, icon: <FileText className="h-5 w-5 text-accent" /> },
              { label: "API Endpoints", value: data.stats.apiEndpoints, icon: <Code2 className="h-5 w-5 text-purple" /> },
              { label: "Components", value: data.stats.components, icon: <Box className="h-5 w-5 text-success" /> },
              { label: "Types", value: data.stats.types, icon: <Database className="h-5 w-5 text-warning" /> },
              { label: "Data Flows", value: data.stats.dataFlows, icon: <Workflow className="h-5 w-5 text-info" /> },
              { label: "Dependencies", value: data.stats.dependencies, icon: <Layers className="h-5 w-5 text-muted-foreground" /> },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-card p-4">
                {m.icon}
                <p className="mt-2 text-2xl font-bold text-foreground">{m.value}</p>
                <p className="text-xs text-muted">{m.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Generated Documentation Files</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Available at <code className="text-accent">docs/generated/</code> — also regenerated on every <code className="text-accent">npm run build</code>
            </p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { name: "architecture.md", desc: "System architecture & stack overview", icon: Layers },
                { name: "api-reference.md", desc: "All REST endpoints with params", icon: Code2 },
                { name: "routes-map.md", desc: "Page and API route tree", icon: GitBranch },
                { name: "data-flows.md", desc: "Page → API → DB flow diagrams", icon: Workflow },
                { name: "service-map.md", desc: "External integrations & ER diagram", icon: Network },
                { name: "components.md", desc: "UI component catalog & deps", icon: Box },
                { name: "types.md", desc: "TypeScript type definitions", icon: Database },
                { name: "dependencies.md", desc: "npm package list", icon: Layers },
                { name: "analysis.json", desc: "Raw analysis data (JSON)", icon: FileText },
              ].map((f) => (
                <div key={f.name} className="flex items-start gap-2 rounded-lg border border-border bg-background p-3">
                  <f.icon className="h-4 w-4 text-muted mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-foreground">{f.name}</p>
                    <p className="text-[10px] text-muted">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Architecture */}
      {tab === "architecture" && (
        <div className="space-y-6">
          <MermaidDiagram
            id="arch"
            chart={`graph TB
    subgraph Client["Browser"]
        UI["React Pages"]
        State["Client State"]
    end
    subgraph NextJS["Next.js App Router"]
        Pages["${data?.stats.pages || 0} Pages"]
        API["${data?.stats.apiEndpoints || 0} API Routes"]
        MW["Dashboard Shell + Layout"]
    end
    subgraph Backend["Backend Services"]
        Prisma["Prisma ORM"]
        SyncEngine["SigmaHQ Sync"]
        DocsAgent["Docs Agent"]
    end
    subgraph Storage["Data Layer"]
        SQLite[("SQLite DB")]
        Fixtures["Mock Fixtures"]
    end
    subgraph External["External"]
        GitHub["GitHub API"]
    end
    UI --> Pages
    Pages --> API
    API --> Prisma
    Prisma --> SQLite
    API --> Fixtures
    SyncEngine --> GitHub
    SyncEngine --> Prisma
    DocsAgent -.->|analyzes| NextJS`}
          />
          <MermaidDiagram
            id="ooda"
            chart={`graph LR
    O["Observe\\nThreat Intel"] --> OR["Orient\\nThreat Modeling"]
    OR --> D["Decide\\nRule Authoring"]
    D --> A["Act\\nDeploy & Tune"]
    A --> O
    Dev["Developer Agent"] --> Sim["Simulation Agent"]
    Sim --> Val["Validation Agent"]
    Val --> Rep["Reporter Agent"]`}
          />
        </div>
      )}

      {/* API Reference */}
      {tab === "api" && data && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-card-hover">
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Method</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Route</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Description</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Query Params</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">File</th>
              </tr>
            </thead>
            <tbody>
              {data.apiEndpoints.map((ep, i) => (
                <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                  <td className="px-4 py-3">
                    <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold", methodColors[ep.method] || "text-muted bg-muted/10")}>
                      {ep.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{ep.route}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{ep.description}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {ep.queryParams?.map((p) => (
                        <span key={p} className="rounded bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{p}</span>
                      )) || <span className="text-[10px] text-muted">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-muted truncate max-w-[200px]">{ep.filePath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Routes */}
      {tab === "routes" && data && (
        <div className="space-y-6">
          <MermaidDiagram
            id="routes"
            chart={(() => {
              let c = "graph TD\n    root[\"/\"]\n";
              const seen = new Set<string>();
              for (const r of data.routes.filter((r) => r.type === "page")) {
                const segs = r.path.split("/").filter(Boolean);
                let parent = "root";
                let acc = "";
                for (const seg of segs) {
                  acc += "_" + seg.replace(/:/g, "");
                  const nid = `p${acc}`;
                  if (!seen.has(nid)) {
                    seen.add(nid);
                    c += `    ${nid}["/${seg}"]\n    ${parent} --> ${nid}\n`;
                  }
                  parent = nid;
                }
              }
              return c;
            })()}
          />
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-card-hover">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Type</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Route</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Methods</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">File</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Dynamic</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.map((r, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-4 py-3">
                      <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold",
                        r.type === "page" ? "bg-accent/10 text-accent" : r.type === "api" ? "bg-purple/10 text-purple" : "bg-muted/10 text-muted")}>
                        {r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{r.path}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {r.methods?.map((m) => (
                          <span key={m} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", methodColors[m])}>{m}</span>
                        )) || <span className="text-[10px] text-muted">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-muted truncate max-w-[250px]">{r.filePath}</td>
                    <td className="px-4 py-3 text-[10px] text-muted-foreground">{r.isDynamic ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Flows */}
      {tab === "flows" && data && (
        <div className="space-y-6">
          <MermaidDiagram
            id="flows"
            chart={(() => {
              let c = "graph LR\n";
              const nodeIds = new Map<string, string>();
              let cnt = 0;
              function nid(name: string) {
                if (!nodeIds.has(name)) nodeIds.set(name, `n${cnt++}`);
                return nodeIds.get(name)!;
              }
              const pages = data.dataFlows.filter((f) => f.from.startsWith("Page"));
              const apiDb = data.dataFlows.filter((f) => f.from.startsWith("API") && f.to.startsWith("DB"));
              if (pages.length > 0) {
                c += "    subgraph Pages\n";
                for (const f of pages) c += `        ${nid(f.from)}["${f.from}"]\n`;
                c += "    end\n";
              }
              const apiNodes = new Set([...pages.map((f) => f.to), ...apiDb.map((f) => f.from)]);
              if (apiNodes.size > 0) {
                c += "    subgraph APIs\n";
                for (const n of apiNodes) c += `        ${nid(n)}["${n}"]\n`;
                c += "    end\n";
              }
              const dbNodes = new Set(apiDb.map((f) => f.to));
              if (dbNodes.size > 0) {
                c += "    subgraph Database\n";
                for (const n of dbNodes) c += `        ${nid(n)}[("${n}")]\n`;
                c += "    end\n";
              }
              for (const f of data.dataFlows) c += `    ${nid(f.from)} -->|"${f.label}"| ${nid(f.to)}\n`;
              return c;
            })()}
          />
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-card-hover">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">From</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted"></th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">To</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Label</th>
                </tr>
              </thead>
              <tbody>
                {data.dataFlows.map((f, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-4 py-3 text-xs text-foreground font-mono">{f.from}</td>
                    <td className="px-4 py-3"><ArrowRight className="h-3 w-3 text-muted" /></td>
                    <td className="px-4 py-3 text-xs text-foreground font-mono">{f.to}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{f.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Services */}
      {tab === "services" && (
        <div className="space-y-6">
          <MermaidDiagram
            id="services"
            chart={`graph TB
    subgraph Platform["Detection Engineering Platform"]
        Web["Web UI\\n(Next.js)"]
        API["API Layer\\n(Route Handlers)"]
        DB[("SQLite\\n(Prisma ORM)")]
        Sync["Sync Engine"]
        Agent["Docs Agent"]
    end
    subgraph External["External Services"]
        GH["GitHub API\\n(SigmaHQ)"]
        Splunk["Splunk\\n(SPL)"]
        MDE["Microsoft Defender\\n(KQL)"]
        ART["Atomic Red Team"]
        CALDERA["MITRE CALDERA"]
    end
    subgraph Data["Data Sources"]
        MITRE["MITRE ATT&CK"]
        SigmaRules["Sigma Rules"]
        STIX["STIX Objects"]
    end
    Web -->|REST| API
    API -->|ORM| DB
    Sync -->|REST| GH
    Sync -->|write| DB
    API -.->|validate| Splunk
    API -.->|validate| MDE
    API -.->|execute| ART
    API -.->|execute| CALDERA
    API -->|reference| MITRE
    GH -->|sync| SigmaRules
    API -->|ingest| STIX
    Agent -.->|analyze| Platform`}
          />
          <MermaidDiagram
            id="sequence"
            chart={`sequenceDiagram
    participant U as Browser
    participant P as Pages
    participant A as API Routes
    participant S as Sync Engine
    participant D as SQLite
    participant G as GitHub

    U->>P: Navigate to /community/sigmahq
    P->>A: GET /api/community/sigmahq/summary
    A->>D: Query community_sources
    D-->>A: Source stats
    A-->>P: JSON
    P-->>U: Render

    U->>A: POST /api/community/sigmahq/sync
    A->>S: syncSigmaHQ()
    S->>G: GET tree (3000+ rules)
    G-->>S: File tree
    loop Batch of 50
        S->>G: Fetch YAML
        G-->>S: Content
        S->>D: Upsert rule
    end
    S-->>A: Result
    A-->>U: Summary`}
          />
          <MermaidDiagram
            id="erd"
            chart={`erDiagram
    community_sources {
        string id PK
        string name UK
        string type
        datetime lastSyncAt
        int totalRules
        int importedRulesCount
    }
    community_sigma_rules {
        string id PK
        string sigmaId
        string title
        string level
        string detectionYaml
        string filePath
        string mitreTechniques
        string changeStatus
        string contentHash
    }
    sync_runs {
        string id PK
        string sourceId FK
        string status
        int newCount
        int modifiedCount
        int deletedCount
    }
    community_sources ||--o{ community_sigma_rules : has
    community_sources ||--o{ sync_runs : tracks`}
          />
        </div>
      )}

      {/* Components */}
      {tab === "components" && data && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {["ui", "layout", "feature"].map((cat) => {
              const count = data.components.filter((c) => c.category === cat).length;
              return (
                <div key={cat} className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs text-muted capitalize">{cat}</p>
                  <p className="text-2xl font-bold text-foreground">{count}</p>
                </div>
              );
            })}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted">Total</p>
              <p className="text-2xl font-bold text-foreground">{data.stats.components}</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-card-hover">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Component</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Category</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">Exports</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">File</th>
                </tr>
              </thead>
              <tbody>
                {data.components.map((c, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-card-hover transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        c.category === "ui" ? "bg-accent/10 text-accent" : c.category === "layout" ? "bg-purple/10 text-purple" : "bg-success/10 text-success")}>
                        {c.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.exports.map((e) => (
                          <span key={e} className="rounded bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{e}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-muted truncate max-w-[250px]">{c.filePath}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
