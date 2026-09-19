import { prisma } from "@/lib/prisma";
import https from "https";

// ── GitHub credentials from Integration model ──

export async function getGitHubCredentials(): Promise<{ token: string; apiUrl: string } | null> {
  const integration = await prisma.integration.findUnique({ where: { name: "GitHub Actions" } });
  if (!integration || !integration.apiKey) return null;
  return { token: integration.apiKey, apiUrl: integration.apiUrl || "https://api.github.com" };
}

/**
 * Resolve the GitHub owner to push to from the configured integration alone:
 * an explicit `extraConfig.owner`/`username` on the integration, else the
 * authenticated user's login (GET /user). Lets report push work "based on the
 * git integration" without the user typing an owner each time.
 */
let _ownerCache: { owner: string; at: number } | null = null;
export async function getDefaultGitHubOwner(): Promise<string> {
  const integration = await prisma.integration.findUnique({ where: { name: "GitHub Actions" } });
  if (!integration || !integration.apiKey) return "";
  // Prefer an explicitly configured owner/org.
  try {
    const cfg = JSON.parse(integration.extraConfig || "{}");
    if (cfg.owner) return String(cfg.owner);
  } catch { /* ignore */ }
  if (integration.username) return integration.username;
  // Fall back to the token's authenticated login (cached 5 min).
  if (_ownerCache && Date.now() - _ownerCache.at < 300_000) return _ownerCache.owner;
  try {
    const res = await githubRequest(integration.apiKey, "GET", "/user", undefined, integration.apiUrl || "https://api.github.com");
    const login = res.status < 400 ? String(res.data?.login || "") : "";
    if (login) _ownerCache = { owner: login, at: Date.now() };
    return login;
  } catch { return ""; }
}

// ── Generic GitHub API request ──

export function githubRequest(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  apiUrl = "https://api.github.com"
): Promise<{ status: number; data: any }> {
  const url = path.startsWith("http") ? new URL(path) : new URL(path, apiUrl);
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+v3+json",
          "User-Agent": "DetectOps/1.0",
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
        },
        rejectUnauthorized: true,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let data: any = raw;
          try { data = JSON.parse(raw); } catch { /* keep raw */ }
          resolve({ status: res.statusCode || 0, data });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("GitHub API timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Ensure repository exists ──

export async function ensureRepository(
  token: string,
  owner: string,
  repo: string
): Promise<{ created: boolean; url: string }> {
  const check = await githubRequest(token, "GET", `/repos/${owner}/${repo}`);
  if (check.status === 200) {
    return { created: false, url: check.data.html_url };
  }

  // Try creating under user
  const create = await githubRequest(token, "POST", "/user/repos", {
    name: repo,
    description: "Detection use case reports managed by DetectOps — automated simulation-to-detection reporting",
    private: false,
    auto_init: true,
    has_issues: true,
    has_projects: true,
  });

  if (create.status === 201) {
    return { created: true, url: create.data.html_url };
  }

  throw new Error(`Failed to create repository: ${create.data?.message || create.status}`);
}

// ── Push markdown file to repo ──

export async function pushMarkdownFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string
): Promise<{ url: string; sha: string }> {
  // Check if file exists (get SHA for update)
  const existing = await githubRequest(token, "GET", `/repos/${owner}/${repo}/contents/${filePath}`);
  const sha = existing.status === 200 ? existing.data.sha : undefined;

  const result = await githubRequest(token, "PUT", `/repos/${owner}/${repo}/contents/${filePath}`, {
    message,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  });

  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`Failed to push file: ${result.data?.message || result.status}`);
  }

  return {
    url: result.data.content?.html_url || `https://github.com/${owner}/${repo}/blob/main/${filePath}`,
    sha: result.data.content?.sha || "",
  };
}

// ── Create GitHub Issue ──

export async function createIssue(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[]
): Promise<{ number: number; url: string; nodeId: string }> {
  const result = await githubRequest(token, "POST", `/repos/${owner}/${repo}/issues`, {
    title,
    body,
    labels: labels || ["detection-report"],
  });

  if (result.status !== 201) {
    throw new Error(`Failed to create issue: ${result.data?.message || result.status}`);
  }

  return {
    number: result.data.number,
    url: result.data.html_url,
    nodeId: result.data.node_id,
  };
}

// ── Push file to a branch and create PR ──

export async function pushFileToBranchAndCreatePR(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  commitMessage: string,
  prTitle: string,
  prBody: string,
  baseBranch = "main"
): Promise<{ branchName: string; prNumber: number; prUrl: string; fileUrl: string }> {
  // 1. Get the SHA of the base branch HEAD
  const refRes = await githubRequest(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
  if (refRes.status !== 200) {
    throw new Error(`Cannot find base branch '${baseBranch}': ${refRes.data?.message || refRes.status}`);
  }
  const baseSha = refRes.data.object.sha;

  // 2. Create a new branch
  const branchName = `report/${filePath.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").slice(0, 50)}-${Date.now().toString(36)}`;
  const branchRes = await githubRequest(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });
  if (branchRes.status !== 201) {
    throw new Error(`Failed to create branch: ${branchRes.data?.message || branchRes.status}`);
  }

  // 3. Push file to the new branch
  const existingFile = await githubRequest(token, "GET", `/repos/${owner}/${repo}/contents/${filePath}?ref=${branchName}`);
  const fileSha = existingFile.status === 200 ? existingFile.data.sha : undefined;

  const pushRes = await githubRequest(token, "PUT", `/repos/${owner}/${repo}/contents/${filePath}`, {
    message: commitMessage,
    content: Buffer.from(content).toString("base64"),
    branch: branchName,
    ...(fileSha ? { sha: fileSha } : {}),
  });
  if (pushRes.status !== 200 && pushRes.status !== 201) {
    throw new Error(`Failed to push file to branch: ${pushRes.data?.message || pushRes.status}`);
  }
  const fileUrl = pushRes.data.content?.html_url || `https://github.com/${owner}/${repo}/blob/${branchName}/${filePath}`;

  // 4. Create Pull Request
  const prRes = await githubRequest(token, "POST", `/repos/${owner}/${repo}/pulls`, {
    title: prTitle,
    body: prBody,
    head: branchName,
    base: baseBranch,
  });
  if (prRes.status !== 201) {
    throw new Error(`Failed to create PR: ${prRes.data?.message || prRes.status}`);
  }

  // 5. Add labels to PR
  await githubRequest(token, "POST", `/repos/${owner}/${repo}/issues/${prRes.data.number}/labels`, {
    labels: ["detection-report", "needs-review"],
  }).catch(() => {}); // labels may not exist yet

  return {
    branchName,
    prNumber: prRes.data.number,
    prUrl: prRes.data.html_url,
    fileUrl,
  };
}

// ── List Pull Requests ──

export async function listPullRequests(
  token: string,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "all"
): Promise<any[]> {
  const result = await githubRequest(token, "GET", `/repos/${owner}/${repo}/pulls?state=${state}&per_page=50&sort=updated&direction=desc`);
  if (result.status !== 200) return [];
  return result.data;
}

// ── Get PR reviews ──

export async function getPRReviews(
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<any[]> {
  const result = await githubRequest(token, "GET", `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`);
  if (result.status !== 200) return [];
  return result.data;
}

// ── Merge a PR ──

export async function mergePR(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  mergeMethod: "merge" | "squash" | "rebase" = "squash"
): Promise<{ merged: boolean; message: string }> {
  const result = await githubRequest(token, "PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    merge_method: mergeMethod,
  });
  return { merged: result.status === 200, message: result.data?.message || "" };
}

// ── Create GitHub Project V2 (GraphQL) ──

export async function createProjectV2(
  token: string,
  owner: string,
  title: string
): Promise<{ id: string; url: string; number: number }> {
  // Get owner node ID
  const ownerRes = await githubRequest(token, "POST", "https://api.github.com/graphql", {
    query: `query { user(login: "${owner}") { id } }`,
  });
  const ownerId = ownerRes.data?.data?.user?.id;
  if (!ownerId) {
    // Try as org
    const orgRes = await githubRequest(token, "POST", "https://api.github.com/graphql", {
      query: `query { organization(login: "${owner}") { id } }`,
    });
    const orgId = orgRes.data?.data?.organization?.id;
    if (!orgId) throw new Error("Could not find GitHub user/org");
    return createProjectForOwner(token, orgId, title);
  }
  return createProjectForOwner(token, ownerId, title);
}

async function createProjectForOwner(
  token: string,
  ownerId: string,
  title: string
): Promise<{ id: string; url: string; number: number }> {
  const result = await githubRequest(token, "POST", "https://api.github.com/graphql", {
    query: `mutation { createProjectV2(input: { ownerId: "${ownerId}", title: "${title}" }) { projectV2 { id url number } } }`,
  });

  const project = result.data?.data?.createProjectV2?.projectV2;
  if (!project) {
    throw new Error(`Failed to create project: ${JSON.stringify(result.data?.errors || result.data)}`);
  }

  return { id: project.id, url: project.url, number: project.number };
}

// ── Generate markdown report ──

interface ReportData {
  name: string;
  description: string;
  severity: string;
  status: string;
  assignee: string;
  platform: string;
  maturityLevel: string;
  criticality: string;
  phase: string;
  procedureCoverage: string;
  deviceGroup: string;
  deviceCoverage: string;
  falsePositive: string;
  detectionQuery: string;
  observations: string;
  reasonsForFailure: string;
  recommendations: string;
  definedAndWorking: boolean;
  needsImprovement: boolean;
  startDate: string | null;
  endDate: string | null;
  simulations: { description: string; output: string; order: number }[];
}

export function generateMarkdownReport(report: ReportData): string {
  const slug = report.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const startDate = report.startDate ? new Date(report.startDate).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : "N/A";
  const endDate = report.endDate ? new Date(report.endDate).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : "N/A";

  let md = `# ${report.name}

## Use Case Overview

| Field | Value |
|-------|-------|
| **Name** | \`${slug}\` |
| **Description** | ${report.description} |
| **Severity** | ${report.severity} |
| **Status** | ${report.status} |
| **Assignee** | ${report.assignee || "Unassigned"} |
| **Platform** | ${report.platform || "N/A"} |
| **Maturity Level** | ${report.maturityLevel || "N/A"} |
| **Criticality** | ${report.criticality || report.severity} |
| **Phase** | ${report.phase || "N/A"} |
| **Procedure Coverage** | ${report.procedureCoverage || "Full Procedure Covered"} |
| **Device Group** | ${report.deviceGroup || "Cover All Devices"} |
| **Device Coverage** | ${report.deviceCoverage || "Cover All Devices"} |
| **False Positive** | ${report.falsePositive} |
| **Defined & Working** | ${report.definedAndWorking ? "Yes" : "No"} |
| **Needs Improvement** | ${report.needsImprovement ? "Yes" : "No"} |
| **Start Date** | ${startDate} |
| **End Date** | ${endDate} |

---

## Detection Query

\`\`\`spl
${report.detectionQuery || "N/A"}
\`\`\`

---

## Simulation & Output
`;

  if (report.simulations.length === 0) {
    md += "\n*No simulations recorded.*\n";
  } else {
    for (const sim of report.simulations) {
      md += `
### Simulation: ${sim.order + 1}

**Description:** ${sim.description}

**Output and Snapshot of Simulation:**

\`\`\`
${sim.output || "No output captured"}
\`\`\`

**Snapshot of Detection:** *(See Splunk/SIEM dashboard)*

---
`;
    }
  }

  md += `
## Observations

${report.observations || "*No observations recorded.*"}

---

## Reason for Failure

${report.reasonsForFailure || "*No failures recorded — all detections working.*"}

---

## Recommendations

${report.recommendations || "*No recommendations at this time.*"}

---

## Checklist

### Requirements
- [${report.definedAndWorking ? "x" : " "}] Validate Device Coverage
- [${report.definedAndWorking ? "x" : " "}] Validate Query Syntax and Logic
- [${report.needsImprovement ? " " : "x"}] Check for New UC Recommendation
- [${report.falsePositive === "No" ? "x" : " "}] Check for False Positives
- [${report.procedureCoverage ? "x" : " "}] Procedure Coverage

### Deliverables
- [${report.observations ? "x" : " "}] Observations
- [${report.reasonsForFailure ? "x" : " "}] Reason for Failures
- [${report.recommendations ? "x" : " "}] Recommendation Details
- [ ] PR for Detailed Analysis

---

*Report generated by DetectOps on ${new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}*
`;

  return md;
}

// ── Generate GitHub Issue body ──

export function generateIssueBody(report: ReportData, reportUrl: string): string {
  const slug = report.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  return `## ${slug}

### UC Description
${report.description}

### UC Logic
\`\`\`spl
${report.detectionQuery || "N/A"}
\`\`\`

### Requirement Testing Parameters
- [ ] Validate Device Coverage
- [ ] Validate Query Syntax and Logic
- [ ] Check for New UC Recommendation
- [ ] Check for False Positives
- [ ] Procedure Coverage

### Deliverables
- [ ] Observations
- [ ] Reason for Failures
- [ ] Recommendation Details
- [ ] PR for Detailed Analysis

---

| Field | Value |
|-------|-------|
| **Severity** | ${report.severity} |
| **Status** | ${report.status} |
| **Platform** | ${report.platform || "N/A"} |
| **Assignee** | ${report.assignee || "Unassigned"} |
| **Maturity Level** | ${report.maturityLevel || "N/A"} |
| **Procedure Coverage** | ${report.procedureCoverage || "Full Procedure Covered"} |
| **Device Coverage** | ${report.deviceCoverage || "Cover All Devices"} |
| **False Positive** | ${report.falsePositive} |
| **Defined & Working** | ${report.definedAndWorking ? "Yes" : "No"} |
| **Needs Improvement** | ${report.needsImprovement ? "Yes" : "No"} |
| **Detailed Report** | [View Report](${reportUrl}) |
`;
}
