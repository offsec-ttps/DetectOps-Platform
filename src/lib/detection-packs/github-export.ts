/**
 * Detection Pack → GitHub Issue export.
 *
 *   renderIssueBody(pack)              — standardised Markdown body
 *   pushPackToGithub(packId, opts)     — creates an issue OR appends an update
 *                                          comment if the pack already has one
 *
 * Reuses `src/lib/github.ts::createIssue` and the same `githubRequest` helper
 * for the comment-append path. Default labels track the pack's status.
 */

import { prisma } from "@/lib/prisma";
import { createIssue, githubRequest } from "@/lib/github";
import { logEvent } from "@/lib/event-log";

interface Step {
  order?: number;
  title?: string;
  action?: string;
  expectedFinding?: string;
  escalateIf?: string;
  references?: string[];
}

function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

const STATUS_LABELS: Record<string, string[]> = {
  draft:      ["detection-pack", "status:draft"],
  test:       ["detection-pack", "status:test"],
  tune:       ["detection-pack", "status:tune"],
  validate:   ["detection-pack", "status:validate"],
  production: ["detection-pack", "status:production"],
  deprecated: ["detection-pack", "status:deprecated"],
};

function defaultLabelsForStatus(status: string): string[] {
  return STATUS_LABELS[status] || ["detection-pack"];
}

function ladder(steps: Step[]): string {
  if (!steps?.length) return "_(none)_";
  return steps.map((s, i) => {
    const ref = (s.references || []).map((r) => `\n      - ${r}`).join("");
    const esc = s.escalateIf && s.escalateIf.toLowerCase() !== "none" ? `\n  - **Escalate if:** ${s.escalateIf}` : "";
    return `- [ ] **${String(s.order || i + 1).padStart(2, "0")}. ${s.title || "(untitled)"}**\n  - **Action:** ${s.action || "—"}\n  - **Expected finding:** ${s.expectedFinding || "—"}${esc}${ref ? `\n  - **References:**${ref}` : ""}`;
  }).join("\n");
}

export interface RenderInput {
  pack: {
    id: string; name: string; slug: string;
    description: string; severity: string; riskScore: number;
    category: string; status: string;
    platforms: string[]; dataSources: string[];
    mitreTechniques: string[]; mitreTactics: string[];
    references: Array<{ title: string; url: string; type: string }>;
    sourceType: string; sourceTable: string; sourceRefId: string;
    createdAt: Date | string; updatedAt: Date | string;
  };
  rules: Array<{ format: string; title: string; body: string; language: string; falsePositives: string[] }>;
  simulations: Array<{ framework: string; refId: string; techniqueId: string; displayName: string; rationale: string }>;
  irPlaybook: {
    summary: string;
    l1Steps: Step[]; l2Steps: Step[]; l3Steps: Step[];
    containment: Step[]; eradication: Step[]; recovery: Step[];
  } | null;
}

export function renderIssueTitle(pack: RenderInput["pack"]): string {
  return `[Detection Pack] ${pack.name}`;
}

export function renderIssueBody(input: RenderInput): string {
  const { pack, rules, simulations, irPlaybook } = input;
  const tech = pack.mitreTechniques.length ? pack.mitreTechniques.map((t) => `\`${t}\``).join(" · ") : "_(none)_";
  const tact = pack.mitreTactics.length ? pack.mitreTactics.join(", ") : "—";
  const plat = pack.platforms.length ? pack.platforms.map((p) => `\`${p}\``).join(" · ") : "—";
  const ds = pack.dataSources.length ? pack.dataSources.map((d) => `- ${d}`).join("\n") : "_(none)_";

  const sections: string[] = [];

  sections.push(`## Summary

${pack.description || "_(no description)_"}

| | |
|---|---|
| **Severity** | \`${pack.severity}\` |
| **Risk score** | ${pack.riskScore}/100 |
| **Category** | \`${pack.category}\` |
| **Status** | \`${pack.status}\` |
| **MITRE techniques** | ${tech} |
| **MITRE tactics** | ${tact} |
| **Platforms** | ${plat} |
| **Source** | \`${pack.sourceTable}\` · \`${pack.sourceRefId}\` |
| **Pack id** | \`${pack.id}\` |
| **Created** | ${new Date(pack.createdAt).toISOString()} |
| **Updated** | ${new Date(pack.updatedAt).toISOString()} |

### Required data sources

${ds}`);

  // Detection rules
  if (rules.length) {
    const blocks = rules.map((r) => {
      const lang = r.format === "sigma" ? "yaml"
                 : r.format === "spl" ? "spl"
                 : r.format === "kql" ? "kql"
                 : r.format === "elastic-eql" ? "eql"
                 : r.format === "elastic-lucene" ? "lucene"
                 : r.format === "yara" ? "text"
                 : "";
      const fp = r.falsePositives?.length ? `\n\n_Known false positives:_\n${r.falsePositives.map((f) => `- ${f}`).join("\n")}` : "";
      return `### ${r.title} \`${r.format}\`\n\n\`\`\`${lang}\n${r.body}\n\`\`\`${fp}`;
    }).join("\n\n");
    sections.push(`## Detection rules (${rules.length})\n\n${blocks}`);
  } else {
    sections.push(`## Detection rules\n\n_(none emitted)_`);
  }

  // Simulations
  if (simulations.length) {
    const fwIcon: Record<string, string> = { atomic: "🧪", purplesharp: "🎯", stratus: "☁️" };
    const lines = simulations.map((s) => {
      const icon = fwIcon[s.framework] || "▶";
      return `- [ ] ${icon} **\`${s.techniqueId}\`** — ${s.displayName} _(${s.framework}: \`${s.refId}\`)_\n  ${s.rationale}`;
    });
    sections.push(`## Attack simulations (${simulations.length})\n\n${lines.join("\n")}`);
  }

  // IRP
  if (irPlaybook) {
    sections.push(`## Incident Response Playbook

${irPlaybook.summary || "_(no summary)_"}

### L1 — Triage
${ladder(irPlaybook.l1Steps)}

### L2 — Investigation + initial response
${ladder(irPlaybook.l2Steps)}

### L3 — Forensics + root cause
${ladder(irPlaybook.l3Steps)}

### Containment
${ladder(irPlaybook.containment)}

### Eradication
${ladder(irPlaybook.eradication)}

### Recovery
${ladder(irPlaybook.recovery)}`);
  }

  // References
  if (pack.references.length) {
    const refLines = pack.references.map((r) => `- [${r.title || r.url}](${r.url}) \`${r.type}\``).join("\n");
    sections.push(`## References\n\n${refLines}`);
  }

  sections.push(`---\n_Generated by DetectOps Detection Pack pipeline. Pack id: \`${pack.id}\`._`);
  return sections.join("\n\n");
}

export interface PushOptions {
  /** "owner/repo" — the GitHub repository to push into. */
  repo: string;
  /** Plain PAT. Falls back to env GITHUB_TOKEN when omitted. */
  token?: string;
  /** Override default status-derived labels. */
  labels?: string[];
  /**
   * When true (default) and the pack already has a GitHub issue, append an
   * update comment with the regenerated body instead of creating a new issue.
   * When false, always create a new issue.
   */
  updateIfExists?: boolean;
  /** Caller email/id for the event log. */
  actor?: string;
}

export interface PushResult {
  action: "created" | "commented";
  issueUrl: string;
  issueNumber: number;
}

export async function pushPackToGithub(packId: string, opts: PushOptions): Promise<PushResult> {
  const token = opts.token || process.env.GITHUB_TOKEN || "";
  if (!token) {
    throw Object.assign(new Error("GITHUB_TOKEN not set — pass token in body or set GITHUB_TOKEN in .env"), { code: "missing_token" });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/.test(opts.repo) || opts.repo.includes("..")) {
    throw Object.assign(new Error("repo must be in owner/repo format"), { code: "bad_repo" });
  }
  const [owner, repo] = opts.repo.split("/");

  // Load pack + rules + IRP + sims
  const pack = await prisma.detectionPack.findUnique({
    where: { id: packId },
    include: {
      rules: { orderBy: { createdAt: "asc" } },
      simulations: { orderBy: { createdAt: "asc" } },
      irPlaybook: true,
    },
  });
  if (!pack) throw Object.assign(new Error("pack not found"), { code: "not_found" });

  const input: RenderInput = {
    pack: {
      id: pack.id, name: pack.name, slug: pack.slug,
      description: pack.description, severity: pack.severity, riskScore: pack.riskScore,
      category: pack.category, status: pack.status,
      platforms: safeJson<string[]>(pack.platforms, []),
      dataSources: safeJson<string[]>(pack.dataSources, []),
      mitreTechniques: safeJson<string[]>(pack.mitreTechniques, []),
      mitreTactics: safeJson<string[]>(pack.mitreTactics, []),
      references: safeJson<Array<{ title: string; url: string; type: string }>>(pack.references, []),
      sourceType: pack.sourceType, sourceTable: pack.sourceTable, sourceRefId: pack.sourceRefId,
      createdAt: pack.createdAt, updatedAt: pack.updatedAt,
    },
    rules: pack.rules.map((r) => ({
      format: r.format, title: r.title, body: r.body, language: r.language,
      falsePositives: safeJson<string[]>(r.falsePositives, []),
    })),
    simulations: pack.simulations,
    irPlaybook: pack.irPlaybook ? {
      summary: pack.irPlaybook.summary,
      l1Steps: safeJson<Step[]>(pack.irPlaybook.l1Steps, []),
      l2Steps: safeJson<Step[]>(pack.irPlaybook.l2Steps, []),
      l3Steps: safeJson<Step[]>(pack.irPlaybook.l3Steps, []),
      containment: safeJson<Step[]>(pack.irPlaybook.containment, []),
      eradication: safeJson<Step[]>(pack.irPlaybook.eradication, []),
      recovery: safeJson<Step[]>(pack.irPlaybook.recovery, []),
    } : null,
  };

  const title = renderIssueTitle(input.pack);
  const body = renderIssueBody(input);
  const labels = opts.labels || defaultLabelsForStatus(pack.status);
  const updateIfExists = opts.updateIfExists !== false;

  let result: PushResult;
  if (updateIfExists && pack.githubIssueNumber && pack.githubIssueUrl) {
    // Append comment to existing issue
    const commentBody = `_DetectOps update at ${new Date().toISOString()} — pack regenerated / IRP edited._\n\n${body}`;
    const resp = await githubRequest(
      token, "POST",
      `/repos/${owner}/${repo}/issues/${pack.githubIssueNumber}/comments`,
      { body: commentBody },
    );
    if (resp.status !== 201) {
      throw new Error(`Failed to comment on issue #${pack.githubIssueNumber}: ${resp.data?.message || resp.status}`);
    }
    result = { action: "commented", issueUrl: pack.githubIssueUrl, issueNumber: pack.githubIssueNumber };
  } else {
    const issue = await createIssue(token, owner, repo, title, body, labels);
    await prisma.detectionPack.update({
      where: { id: packId },
      data: { githubIssueUrl: issue.url, githubIssueNumber: issue.number },
    });
    result = { action: "created", issueUrl: issue.url, issueNumber: issue.number };
  }

  void logEvent({
    category: "detection-pack",
    action: result.action === "created" ? "detection-pack.github-push.created" : "detection-pack.github-push.commented",
    actor: opts.actor || "anonymous",
    status: "ok",
    targetType: "DetectionPack", targetId: packId,
    message: `${result.action} #${result.issueNumber} in ${opts.repo}`,
    details: { packId, repo: opts.repo, issueNumber: result.issueNumber, issueUrl: result.issueUrl, labels, status: pack.status },
  });
  return result;
}
