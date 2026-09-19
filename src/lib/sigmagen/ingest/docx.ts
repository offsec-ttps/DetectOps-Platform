/**
 * DOCX ingestion via `mammoth` (pure-JS, no native binaries).
 * Extracts raw text; embedded images/styling are ignored.
 */

import { type NormalizedInput, MAX_TEXT_CHARS } from "./types";
import { extractIocs } from "./ioc";

export async function normalizeDocx(buffer: Buffer, fileName = "document.docx"): Promise<NormalizedInput> {
  const mammoth = (await import("mammoth")).default as { extractRawText(opts: { buffer: Buffer }): Promise<{ value: string }> };

  let value = "";
  try {
    ({ value } = await mammoth.extractRawText({ buffer }));
  } catch (err) {
    throw new Error(`Failed to parse DOCX "${fileName}": ${(err as Error).message}`);
  }

  const cleaned = (value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const iocs = extractIocs(cleaned);

  return {
    kind: "docx",
    title: fileName.replace(/\.docx$/i, "").slice(0, 160) || "Word document",
    text: cleaned.slice(0, MAX_TEXT_CHARS),
    charCount: cleaned.length,
    iocs,
    references: iocs.url.slice(0, 20).map((url) => ({ title: url, url, type: "other" })),
    meta: { fileName, truncated: cleaned.length > MAX_TEXT_CHARS },
  };
}
