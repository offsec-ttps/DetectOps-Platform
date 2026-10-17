import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ReportFormat = "md" | "docx" | "pdf";

export const REPORT_MIME: Record<ReportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
};

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number) => { if (!done) { done = true; resolve(code); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
    } catch { finish(-1); return; }
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } finish(-1); }, timeoutMs);
    child.on("error", () => { clearTimeout(t); finish(-1); });
    child.on("close", (code) => { clearTimeout(t); finish(code ?? -1); });
  });
}

/**
 * Render a Markdown document to the requested format and return its bytes.
 *
 * Mirrors the proven offline pipeline used for coverage assessments
 * (scripts/generate_assessment_report.py): Markdown → DOCX via pandoc, then
 * DOCX → PDF via LibreOffice/soffice. Binaries are resolved from PATH and can be
 * overridden with PANDOC_BIN / SOFFICE_BIN. Throws a clear error when a required
 * converter is unavailable so the caller can surface it (md is always available).
 */
export async function renderMarkdownTo(markdown: string, basename: string, format: ReportFormat): Promise<Buffer> {
  if (format === "md") return Buffer.from(markdown, "utf-8");

  const safeBase = (basename || "report").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120) || "report";
  const dir = mkdtempSync(join(tmpdir(), "report-render-"));
  const mdPath = join(dir, `${safeBase}.md`);
  const docxPath = join(dir, `${safeBase}.docx`);
  const pdfPath = join(dir, `${safeBase}.pdf`);
  writeFileSync(mdPath, markdown, "utf-8");

  const pandoc = process.env.PANDOC_BIN || "pandoc";
  const code = await run(pandoc, [mdPath, "-o", docxPath], dir, 60_000);
  if (code !== 0 || !existsSync(docxPath)) {
    throw new Error("DOCX conversion failed — pandoc is not installed or on PATH (set PANDOC_BIN).");
  }
  if (format === "docx") return readFileSync(docxPath);

  const soffice = process.env.SOFFICE_BIN || "soffice";
  const code2 = await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", dir, docxPath], dir, 90_000);
  if (code2 !== 0 || !existsSync(pdfPath)) {
    throw new Error("PDF conversion failed — LibreOffice/soffice is not installed or on PATH (set SOFFICE_BIN).");
  }
  return readFileSync(pdfPath);
}
