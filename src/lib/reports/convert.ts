import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
  try {
    const mdPath = join(dir, `${safeBase}.md`);
    const docxPath = join(dir, `${safeBase}.docx`);
    const pdfPath = join(dir, `${safeBase}.pdf`);
    writeFileSync(mdPath, markdown, "utf-8");

    // The Markdown is built from stored report fields (name/description/logs/SPL),
    // which are user-controlled. Render it defensively so a crafted field can't
    // make the converters read local files or reach the network:
    //  - pandoc --sandbox (>=2.15) blocks all file reads / network fetches, and
    //    the `-raw_html-raw_attribute-raw_tex` reader extensions drop raw
    //    passthrough so embedded OOXML/HTML/TeX can't be injected into the docx.
    const pandoc = process.env.PANDOC_BIN || "pandoc";
    const code = await run(pandoc, [
      "--sandbox", "-f", "markdown-raw_html-raw_attribute-raw_tex", mdPath, "-o", docxPath,
    ], dir, 60_000);
    if (code !== 0 || !existsSync(docxPath)) {
      throw new Error("DOCX conversion failed — pandoc is not installed or on PATH (set PANDOC_BIN).");
    }
    if (format === "docx") return readFileSync(docxPath);

    //  - soffice runs headless with an isolated, throwaway user profile under the
    //    temp dir (never the shared one); headless --convert-to does not update
    //    links/fields or fetch the network, so remote/field includes in the docx
    //    are not resolved.
    const soffice = process.env.SOFFICE_BIN || "soffice";
    const profile = pathToFileURL(join(dir, "soffice-profile")).href;
    const code2 = await run(soffice, [
      `-env:UserInstallation=${profile}`,
      "--headless", "--convert-to", "pdf", "--outdir", dir, docxPath,
    ], dir, 90_000);
    if (code2 !== 0 || !existsSync(pdfPath)) {
      throw new Error("PDF conversion failed — LibreOffice/soffice is not installed or on PATH (set SOFFICE_BIN).");
    }
    return readFileSync(pdfPath);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}
