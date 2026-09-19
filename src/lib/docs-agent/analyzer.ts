import fs from "fs";
import path from "path";

export interface RouteInfo {
  path: string;
  filePath: string;
  type: "page" | "api" | "layout";
  methods?: string[];
  isDynamic: boolean;
  params?: string[];
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  category: "ui" | "layout" | "feature" | "page";
  exports: string[];
  dependencies: string[];
}

export interface TypeInfo {
  name: string;
  kind: "type" | "interface" | "enum";
  exported: boolean;
  line: number;
}

export interface APIEndpoint {
  route: string;
  method: string;
  filePath: string;
  description: string;
  queryParams?: string[];
  bodyShape?: string;
  responseShape?: string;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  label: string;
}

export interface ProjectAnalysis {
  timestamp: string;
  routes: RouteInfo[];
  apiEndpoints: APIEndpoint[];
  components: ComponentInfo[];
  types: TypeInfo[];
  dataFlows: DataFlowEdge[];
  dependencies: Record<string, string>;
  pageCount: number;
  apiCount: number;
  componentCount: number;
  typeCount: number;
}

const SRC = path.join(process.cwd(), "src");

function walkDir(dir: string, filter?: (f: string) => boolean): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "generated") continue;
      results.push(...walkDir(full, filter));
    } else if (!filter || filter(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function relPath(p: string): string {
  return path.relative(process.cwd(), p).replace(/\\/g, "/");
}

/** Convert file system path to Next.js route */
function fileToRoute(filePath: string): string {
  let route = filePath
    .replace(/.*src\/app/, "")
    .replace(/\/page\.(tsx|ts|jsx|js)$/, "")
    .replace(/\/route\.(tsx|ts|jsx|js)$/, "")
    .replace(/\/layout\.(tsx|ts|jsx|js)$/, "/__layout__")
    .replace(/\(([^)]+)\)\//g, "") // strip route groups like (dashboard)
    .replace(/\[([^\]]+)\]/g, ":$1"); // [id] → :id
  if (route === "") route = "/";
  return route;
}

function extractHTTPMethods(content: string): string[] {
  const methods: string[] = [];
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(content)) {
      methods.push(m);
    }
  }
  return methods;
}

function extractQueryParams(content: string): string[] {
  const params: string[] = [];
  const re = /searchParams\.get\(["']([^"']+)["']\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    params.push(m[1]);
  }
  return [...new Set(params)];
}

function extractImports(content: string): string[] {
  const deps: string[] = [];
  const re = /from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    deps.push(m[1]);
  }
  return deps;
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const re = /export\s+(?:default\s+)?(?:function|const|class|type|interface)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    exports.push(m[1]);
  }
  return exports;
}

function extractTypes(content: string): TypeInfo[] {
  const types: TypeInfo[] = [];
  const re = /^(export\s+)?(type|interface|enum)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const lineNum = content.substring(0, m.index).split("\n").length;
    types.push({
      name: m[3],
      kind: m[2] as TypeInfo["kind"],
      exported: !!m[1],
      line: lineNum,
    });
  }
  return types;
}

function guessAPIDescription(route: string, methods: string[], content: string): string {
  // Try to extract from comments
  const commentMatch = content.match(/\/\/\s*(.*(?:endpoint|api|handler|route).*)/i);
  if (commentMatch) return commentMatch[1].trim();

  // Infer from route path
  const parts = route.split("/").filter(Boolean);
  const resource = parts[parts.length - 1] || parts[parts.length - 2] || "resource";
  const verbs = methods.map((m) => {
    switch (m) {
      case "GET": return "List/Get";
      case "POST": return "Create/Trigger";
      case "PUT": case "PATCH": return "Update";
      case "DELETE": return "Delete";
      default: return m;
    }
  });
  return `${verbs.join(", ")} ${resource}`;
}

export function analyzeProject(): ProjectAnalysis {
  const tsFiles = walkDir(SRC, (f) => /\.(tsx?|jsx?)$/.test(f));

  const routes: RouteInfo[] = [];
  const apiEndpoints: APIEndpoint[] = [];
  const components: ComponentInfo[] = [];
  const allTypes: TypeInfo[] = [];
  const dataFlows: DataFlowEdge[] = [];

  for (const file of tsFiles) {
    const rel = relPath(file);
    const content = fs.readFileSync(file, "utf-8");

    // --- Routes (pages & API) ---
    if (file.includes("/app/")) {
      const basename = path.basename(file);
      if (/^page\.(tsx?|jsx?)$/.test(basename)) {
        const route = fileToRoute(file);
        const isDynamic = route.includes(":");
        routes.push({
          path: route,
          filePath: rel,
          type: "page",
          isDynamic,
          params: isDynamic ? (route.match(/:(\w+)/g) || []).map((p) => p.slice(1)) : undefined,
        });
      } else if (/^route\.(tsx?|jsx?)$/.test(basename)) {
        const route = fileToRoute(file);
        const methods = extractHTTPMethods(content);
        const isDynamic = route.includes(":");
        routes.push({ path: route, filePath: rel, type: "api", methods, isDynamic, params: isDynamic ? (route.match(/:(\w+)/g) || []).map((p) => p.slice(1)) : undefined });

        for (const method of methods) {
          apiEndpoints.push({
            route,
            method,
            filePath: rel,
            description: guessAPIDescription(route, [method], content),
            queryParams: method === "GET" ? extractQueryParams(content) : undefined,
          });
        }

        // Track API → DB data flows
        if (content.includes("prisma.")) {
          const models = [...content.matchAll(/prisma\.(\w+)\./g)].map((m) => m[1]);
          for (const model of new Set(models)) {
            dataFlows.push({ from: `API ${route}`, to: `DB ${model}`, label: methods.join("/") });
          }
        }
      } else if (/^layout\.(tsx?|jsx?)$/.test(basename)) {
        routes.push({ path: fileToRoute(file), filePath: rel, type: "layout", isDynamic: false });
      }
    }

    // --- Components ---
    if (file.includes("/components/")) {
      const exports = extractExports(content);
      const deps = extractImports(content);
      let category: ComponentInfo["category"] = "feature";
      if (file.includes("/ui/")) category = "ui";
      else if (file.includes("/layout/")) category = "layout";
      components.push({
        name: exports[0] || path.basename(file, path.extname(file)),
        filePath: rel,
        category,
        exports,
        dependencies: deps.filter((d) => d.startsWith("@/") || d.startsWith(".")),
      });
    }

    // --- Types ---
    if (file.includes("/types/")) {
      allTypes.push(...extractTypes(content));
    }
  }

  // Track page → API data flows
  for (const file of tsFiles) {
    if (!file.includes("/app/") || !path.basename(file).startsWith("page.")) continue;
    const content = fs.readFileSync(file, "utf-8");
    const fetchCalls = [...content.matchAll(/fetch\(["'`]([^"'`]+)["'`]/g)];
    const route = fileToRoute(file);
    for (const fc of fetchCalls) {
      const apiPath = fc[1].replace(/\$\{[^}]+\}/g, ":param").split("?")[0];
      if (apiPath.startsWith("/api/")) {
        dataFlows.push({ from: `Page ${route}`, to: `API ${apiPath}`, label: "fetch" });
      }
    }
  }

  // Read package.json deps
  let dependencies: Record<string, string> = {};
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
    dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch { /* ignore */ }

  return {
    timestamp: new Date().toISOString(),
    routes: routes.sort((a, b) => a.path.localeCompare(b.path)),
    apiEndpoints: apiEndpoints.sort((a, b) => a.route.localeCompare(b.route)),
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    types: allTypes.sort((a, b) => a.name.localeCompare(b.name)),
    dataFlows,
    dependencies,
    pageCount: routes.filter((r) => r.type === "page").length,
    apiCount: apiEndpoints.length,
    componentCount: components.length,
    typeCount: allTypes.length,
  };
}
