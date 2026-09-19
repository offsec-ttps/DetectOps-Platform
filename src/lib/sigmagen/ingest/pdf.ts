/**
 * PDF ingestion.
 *
 * `pdf-parse` is imported LAZILY inside the function: its index module has a
 * historical debug side-effect that tries to read a bundled test PDF when it
 * thinks it's run as the main module. Requiring it on-demand (with a real
 * caller in module.parent) avoids that, and keeps the dep out of the cold path
 * for non-PDF requests.
 */

import { type NormalizedInput, MAX_TEXT_CHARS } from "./types";
import { extractIocs } from "./ioc";

export async function normalizePdf(buffer: Buffer, fileName = "document.pdf"): Promise<NormalizedInput> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = (await import("pdf-parse")).default as (b: Buffer) => Promise<{ text: string; numpages: number; info?: any }>;

  let parsed: { text: string; numpages: number; info?: any };
  try {
    parsed = await pdfParse(buffer);
  } catch (err) {
    throw new Error(`Failed to parse PDF "${fileName}": ${(err as Error).message}`);
  }

  const cleaned = (parsed.text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const iocs = extractIocs(cleaned);
  const title =
    (parsed.info?.Title && String(parsed.info.Title).trim()) ||
    fileName.replace(/\.pdf$/i, "") ||
    "PDF report";

  return {
    kind: "pdf",
    title: title.slice(0, 160),
    text: cleaned.slice(0, MAX_TEXT_CHARS),
    charCount: cleaned.length,
    iocs,
    references: iocs.url.slice(0, 20).map((url) => ({ title: url, url, type: "other" })),
    meta: { fileName, pageCount: parsed.numpages, truncated: cleaned.length > MAX_TEXT_CHARS },
  };
}
