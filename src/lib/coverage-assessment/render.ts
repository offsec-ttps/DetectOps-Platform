import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Render a coverage assessment to md/docx/pdf by spawning the proven, tested
// offline pipeline (scripts/generate_assessment_report.py) — the same precedent
// as the WinRM helper spawn. One source of truth for the report format. pandoc
// (docx) and libreoffice (pdf) are optional; markdown is always produced.

export interface RenderItem {
  tech: string; num: number; name: string; tactic: string;
  status: string; executed: boolean; observed: boolean;
  vis_bucket: string; vis_count: number; indicators: string[]; tail: string;
}
export interface RenderInput {
  assessmentId: string; assessor: string; client: string; lab: string;
  detectionNote: string; items: RenderItem[];
}
export interface RenderOutput { md?: string; docx?: string; pdf?: string; markdown: string; log: string }

export async function renderReport(input: RenderInput): Promise<RenderOutput> {
  const root = process.cwd();
  const outDir = join(root, "reports", "coverage-assessments", input.assessmentId);
  mkdirSync(outDir, { recursive: true });
  const outBase = join(outDir, "report");

  const tmp = mkdtempSync(join(tmpdir(), "cov-"));
  const jsonl = join(tmp, "results.jsonl");
  writeFileSync(jsonl, input.items.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const noteArg: string[] = [];
  if (input.detectionNote.trim()) {
    const nf = join(tmp, "note.md");
    writeFileSync(nf, input.detectionNote);
    noteArg.push("--detection-note", `@${nf}`);
  }

  const args = [
    join(root, "scripts", "generate_assessment_report.py"),
    "--results", jsonl, "--out", outBase,
    "--assessor", input.assessor || "RuSecure",
    "--client", input.client || "Client",
    "--lab", input.lab || "Lab",
    ...noteArg,
  ];
  const py = process.env.REPORT_PYTHON || process.env.WINRM_PYTHON || "python3";

  const log: string = await new Promise((resolve) => {
    const child = spawn(py, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 180_000);
    child.on("close", () => { clearTimeout(killer); resolve(out); });
    child.on("error", (e) => { clearTimeout(killer); resolve(`spawn error: ${e.message}`); });
  });

  const md = outBase + ".md", docx = outBase + ".docx", pdf = outBase + ".pdf";
  const markdown = existsSync(md) ? readFileSync(md, "utf8") : "";
  return {
    md: existsSync(md) ? md : undefined,
    docx: existsSync(docx) ? docx : undefined,
    pdf: existsSync(pdf) ? pdf : undefined,
    markdown,
    log: log.slice(-4000),
  };
}
