/**
 * Markdown renderers for Enterprise Use Case runs.
 *
 *   renderRunReport(uc, run, ...)        → standalone .md report for one run
 *   renderIssueTitle(uc, run)            → "[Enterprise UC] <name> · run <date>"
 *   renderIssueBody(uc, run, comments?)  → Markdown body for a GitHub Issue
 *
 * The Issue body always shows BOTH the original AND the selected detection
 * logic so reviewers see the delta. Comments are attached only when supplied.
 *
 * Patterned after src/lib/detection-packs/github-export.ts so the visual
 * shape stays consistent across the two pipelines.
 */

export interface UseCaseSnapshot {
  id: string;
  name: string;
  description: string;
  severity: string;
  status: string;
  owner: string;
  format: string;
  platforms: string[];
  mitreTechniques: string[];
  mitreTactics: string[];
  siemCompatibility: Record<string, string>;
  originalDetectionLogic: string;
  recommendedDetectionLogic: string;
  editedDetectionLogic: string;
  selectedLogic: string;
  sourceFilename: string | null;
  sourceRowRef: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RunSnapshot {
  id: string;
  scenarioName?: string;
  scenarioOrdinal?: number;
  environmentName?: string;
  environmentKind?: string;
  testedLogicChoice: string;
  mode: string;
  status: string;
  validationOutcome: string;
  durationMs: number;
  exitCode: number | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  actor: string;
  stepResults: Array<{
    stepIndex: number;
    framework: string;
    displayName: string;
    status: string;
    exitCode: number;
    durationMs: number;
    stdoutPreview: string;
    notes: string;
  }>;
  detectionResults: Array<{
    ruleTitle?: string;
    siemBackend?: string;
    integrationName?: string;
    query?: string;
    fired?: boolean;
    evidence?: string;
    queriedAt?: string;
    error?: string;
  }>;
  logs?: string;
}

export interface CommentSnapshot {
  author: string;
  body: string;
  kind: string;
  createdAt: Date | string;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toISOString();
}

function pickSelectedBody(uc: UseCaseSnapshot): string {
  if (uc.selectedLogic === "edited") return uc.editedDetectionLogic;
  if (uc.selectedLogic === "recommended") return uc.recommendedDetectionLogic;
  return uc.originalDetectionLogic;
}

function shortHash(s: string): string {
  // Visual fingerprint so reviewers can tell two bodies apart without
  // needing to diff them by eye. Stable + dependency-free.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}

function fence(body: string, lang: string): string {
  const safeLang = (lang || "").replace(/[^a-zA-Z0-9-]/g, "");
  return "```" + safeLang + "\n" + (body || "(empty)") + "\n```";
}

function tableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function makeSiemMatrixTable(matrix: Record<string, string>): string {
  const keys = Object.keys(matrix);
  if (!keys.length) return "_no SIEM compatibility data_";
  const headers = tableRow(["Backend", "Verdict"]);
  const sep = tableRow(keys.map(() => "---").slice(0, 2));
  const rows = keys.map((k) => tableRow([k, matrix[k]])).join("\n");
  return `${headers}\n${sep}\n${rows}`;
}

function stepIcon(status: string): string {
  if (status === "ok") return "✅";
  if (status === "failure") return "❌";
  if (status === "stubbed") return "🟡";
  if (status === "skipped") return "⏭️";
  return "❔";
}

function coverageIcon(outcome: string): string {
  if (outcome === "matched") return "✅";
  if (outcome === "partial") return "🟡";
  if (outcome === "missed") return "❌";
  if (outcome === "error") return "⚠️";
  return "➖";
}

// ─── Renderers ─────────────────────────────────────────────────────────────

export function renderIssueTitle(uc: UseCaseSnapshot, run?: RunSnapshot): string {
  const stamp = run ? fmtDate(run.completedAt || run.startedAt).slice(0, 10) : fmtDate(uc.updatedAt).slice(0, 10);
  const stat = run ? ` · ${run.status}/${run.validationOutcome || "—"}` : "";
  return `[Enterprise UC] ${uc.name}${stat} · ${stamp}`.slice(0, 240);
}

interface RenderOptions {
  /** What kind of run window to include — "single", "compact", or "full". */
  detail?: "single" | "compact" | "full";
  /** Up to N most recent comments. */
  comments?: CommentSnapshot[];
  /** Where the report came from (Issue push includes this in the footer). */
  generatorTag?: string;
}

export function renderIssueBody(uc: UseCaseSnapshot, run: RunSnapshot | null, opts: RenderOptions = {}): string {
  const selectedBody = pickSelectedBody(uc);
  const selectedLang = uc.selectedLogic === "edited" ? uc.format : uc.selectedLogic === "recommended" ? "sigma" : uc.format;

  const sections: string[] = [];

  // ─── 1. Header ─────────────────────────────────────────────────────────
  sections.push(`## ${uc.name}\n\n${uc.description || "_(no description)_"}`);
  sections.push([
    `| | |`, `| --- | --- |`,
    `| **Severity**     | \`${uc.severity}\` |`,
    `| **Status**       | \`${uc.status}\` |`,
    `| **Owner**        | ${uc.owner || "_unassigned_"} |`,
    `| **Format**       | \`${uc.format}\` |`,
    `| **Selected**     | \`${uc.selectedLogic}\` |`,
    `| **Platforms**    | ${uc.platforms.join(", ") || "_none_"} |`,
    `| **MITRE**        | ${uc.mitreTechniques.length ? uc.mitreTechniques.join(", ") : "_none_"} |`,
    `| **Tactics**      | ${uc.mitreTactics.length ? uc.mitreTactics.join(", ") : "_none_"} |`,
    `| **Source file**  | ${uc.sourceFilename ? `\`${uc.sourceFilename}\`${uc.sourceRowRef ? ` · \`${uc.sourceRowRef}\`` : ""}` : "_manual_"} |`,
    `| **Created**      | ${fmtDate(uc.createdAt)} |`,
    `| **Updated**      | ${fmtDate(uc.updatedAt)} |`,
  ].join("\n"));

  // ─── 2. SIEM compat ────────────────────────────────────────────────────
  sections.push(`### SIEM compatibility\n\n${makeSiemMatrixTable(uc.siemCompatibility)}`);

  // ─── 3. BOTH bodies (Original + Selected) ──────────────────────────────
  sections.push(`### Detection logic (\`original\` · hash ${shortHash(uc.originalDetectionLogic)})\n\n${fence(uc.originalDetectionLogic, uc.format)}`);
  if (uc.selectedLogic !== "original") {
    sections.push(`### Detection logic (\`${uc.selectedLogic}\` · selected · hash ${shortHash(selectedBody)})\n\n${fence(selectedBody, selectedLang)}`);
  } else {
    sections.push(`### Detection logic (\`recommended\` · for reference · hash ${shortHash(uc.recommendedDetectionLogic)})\n\n${fence(uc.recommendedDetectionLogic || "(none generated)", "sigma")}`);
  }

  // ─── 4. Run summary ────────────────────────────────────────────────────
  if (run) {
    sections.push([
      `### Run summary`, ``,
      `| | |`, `| --- | --- |`,
      `| **Run id**             | \`${run.id}\` |`,
      `| **Scenario**           | ${run.scenarioOrdinal != null ? `#${String(run.scenarioOrdinal).padStart(2, "0")} · ` : ""}${run.scenarioName || "_?_"} |`,
      `| **Environment**        | ${run.environmentName || "_?_"} · \`${run.environmentKind || "?"}\` |`,
      `| **Mode**               | \`${run.mode}\` |`,
      `| **Tested logic**       | \`${run.testedLogicChoice}\` |`,
      `| **Status**             | ${stepIcon(run.status === "success" ? "ok" : run.status === "failure" ? "failure" : "skipped")} \`${run.status}\` |`,
      `| **Detection coverage** | ${coverageIcon(run.validationOutcome)} \`${run.validationOutcome || "—"}\` |`,
      `| **Duration**           | ${run.durationMs} ms |`,
      `| **Started**            | ${fmtDate(run.startedAt)} |`,
      `| **Completed**          | ${fmtDate(run.completedAt)} |`,
      `| **Actor**              | \`${run.actor}\` |`,
    ].join("\n"));

    sections.push([
      `### Per-step results`,
      ``,
      tableRow(["#", "Framework", "Display name", "Status", "Exit", "Duration"]),
      tableRow(["---", "---", "---", "---", "---", "---"]),
      ...run.stepResults.map((s) => tableRow([
        String(s.stepIndex + 1),
        `\`${s.framework}\``,
        s.displayName.replace(/\|/g, "\\|").slice(0, 80),
        `${stepIcon(s.status)} \`${s.status}\``,
        String(s.exitCode),
        `${s.durationMs} ms`,
      ])),
    ].join("\n"));

    if (opts.detail === "full") {
      const stepBlocks = run.stepResults.map((s) => {
        const head = `**Step ${s.stepIndex + 1} · \`${s.framework}\`** — ${s.displayName}`;
        const meta = `${stepIcon(s.status)} \`${s.status}\` · exit=${s.exitCode} · ${s.durationMs}ms`;
        const note = s.notes ? `\n_${s.notes}_` : "";
        const out  = s.stdoutPreview ? `\n\n${fence(s.stdoutPreview, "")}` : "";
        return `${head}\n\n${meta}${note}${out}`;
      });
      if (stepBlocks.length) sections.push(`### Step output\n\n${stepBlocks.join("\n\n---\n\n")}`);
    }

    if (run.detectionResults.length) {
      sections.push([
        `### Detection coverage`, ``,
        ...run.detectionResults.map((d, i) => {
          const head = `**${i + 1}. ${d.ruleTitle || "_(unnamed)_"}** · backend=\`${d.siemBackend || "?"}\` · integration=\`${d.integrationName || "?"}\``;
          const verdict = d.fired ? `✅ fired — ${d.evidence || "—"}` : (d.error ? `⚠️ ${d.error}` : `❌ no events`);
          const q = d.query ? `\n\n${fence(d.query, "")}` : "";
          return `${head}\n${verdict}${q}`;
        }),
      ].join("\n\n"));
    }
  } else {
    sections.push(`### Run summary\n\n_No run snapshot supplied._`);
  }

  // ─── 5. Comments ───────────────────────────────────────────────────────
  if (opts.comments && opts.comments.length) {
    sections.push([
      `### Analyst comments`, ``,
      ...opts.comments.map((c) => {
        return `- **${c.author || "_anonymous_"}** · \`${c.kind}\` · ${fmtDate(c.createdAt)}\n  ${c.body.replace(/\n/g, "\n  ")}`;
      }),
    ].join("\n"));
  }

  // ─── 6. Footer ─────────────────────────────────────────────────────────
  sections.push([
    `---`,
    `_Generated by DetectOps Enterprise Use Cases${opts.generatorTag ? ` · ${opts.generatorTag}` : ""}._`,
    `_UC id: \`${uc.id}\`${run ? ` · run id: \`${run.id}\`` : ""}_`,
  ].join("\n"));

  return sections.join("\n\n");
}

export function renderRunReport(uc: UseCaseSnapshot, run: RunSnapshot, opts: { comments?: CommentSnapshot[] } = {}): string {
  const body = renderIssueBody(uc, run, { detail: "full", comments: opts.comments, generatorTag: "report.md" });
  // Standalone .md file gets a generated-on header at the top
  const header = `# Enterprise Use Case Report\n\n_Generated ${new Date().toISOString()}_\n\n`;
  return header + body;
}
