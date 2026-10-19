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
  event_codes: string[];   // real Windows Event IDs observed carrying this atomic
  sources: string[];       // real SIEM sourcetypes/log channels the hits came from
}
export interface RenderInput {
  assessmentId: string; assessor: string; client: string; lab: string;
  brand?: string; siem?: string;              // brand header + installed SIEM (splunk|mde|…)
  detectionNote: string; items: RenderItem[];
}
export type ReportSet = { md?: string; docx?: string; pdf?: string; pptx?: string };
export interface RenderOutput { executive: ReportSet; technical: ReportSet; markdown: string; log: string }

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
    "--brand", input.brand || "DetectOps",
    "--assessor", input.assessor || "RuSecure",
    "--client", input.client || "Client",
    "--lab", input.lab || "Lab",
    "--siem", input.siem || "splunk",
    "--report-type", "both",
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

  const set = (label: string): ReportSet => {
    const out: ReportSet = {};
    for (const f of ["md", "docx", "pdf", "pptx"] as const) {
      const p = `${outBase}-${label}.${f}`;
      if (existsSync(p)) out[f] = p;
    }
    return out;
  };
  const technical = set("technical");
  const markdown = technical.md ? readFileSync(technical.md, "utf8") : "";
  return { executive: set("executive"), technical, markdown, log: log.slice(-4000) };
}

// Branded, magazine-style report (scripts/generate_branded_report.py → HTML →
// PDF via headless Chrome). Reads the assessment from the DB by id, so it runs
// after the assessment row (metrics + items) is persisted. Returns the rendered
// file paths; failures are swallowed (the core md/docx reports are unaffected).
export async function renderBrandedReport(assessmentId: string): Promise<{ pdf?: string; html?: string; log: string }> {
  const root = process.cwd();
  const outBase = join(root, "reports", "coverage-assessments", assessmentId, "report-branded");
  const py = process.env.REPORT_PYTHON || process.env.WINRM_PYTHON || "python3";
  const args = [join(root, "scripts", "generate_branded_report.py"), assessmentId, "--out", outBase];
  const log: string = await new Promise((resolve) => {
    const child = spawn(py, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });
    const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 120_000);
    child.on("close", () => { clearTimeout(killer); resolve(out); });
    child.on("error", (ee) => { clearTimeout(killer); resolve(`spawn error: ${ee.message}`); });
  });
  const pdf = outBase + ".pdf", html = outBase + ".html";
  return { pdf: existsSync(pdf) ? pdf : undefined, html: existsSync(html) ? html : undefined, log: log.slice(-2000) };
}
