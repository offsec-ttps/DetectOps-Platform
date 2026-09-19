/**
 * Plain-text / IOC-paste / free-text ingestion.
 *
 * No external fetch — just normalise whitespace, extract IOCs + any URLs found
 * in the body (so the retrieval step can follow them), and truncate.
 */

import { type NormalizedInput, type IngestKind, MAX_TEXT_CHARS } from "./types";
import { extractIocs } from "./ioc";

/** Heuristic: is this paste mostly indicators rather than prose? */
export function looksLikeIocDump(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    // single short line that is itself an indicator
    return /^(?:[a-fA-F0-9]{32,64}|(?:\d{1,3}\.){3}\d{1,3}|CVE-\d{4}-\d+|https?:\/\/\S+)$/i.test(text.trim());
  }
  const iocLines = lines.filter((l) =>
    /^(?:[a-fA-F0-9]{32,64}|(?:\d{1,3}\.){3}\d{1,3}|CVE-\d{4}-\d+|[\w.-]+\.[a-z]{2,}|https?:\/\/\S+)$/i.test(l),
  );
  return iocLines.length / lines.length > 0.6;
}

export function normalizeText(raw: string, opts: { kind?: IngestKind; title?: string } = {}): NormalizedInput {
  const cleaned = (raw || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const truncated = cleaned.slice(0, MAX_TEXT_CHARS);
  const iocs = extractIocs(cleaned);
  const kind: IngestKind = opts.kind || (looksLikeIocDump(cleaned) ? "ioc" : "text");

  const references = iocs.url.slice(0, 20).map((url) => ({ title: url, url, type: "other" }));

  const firstLine = cleaned.split("\n").find((l) => l.trim().length > 0)?.trim() || "";
  const title = opts.title || (kind === "ioc" ? "IOC set" : firstLine.slice(0, 120) || "Pasted text");

  return {
    kind,
    title,
    text: truncated,
    charCount: cleaned.length,
    iocs,
    references,
    meta: { truncated: cleaned.length > MAX_TEXT_CHARS },
  };
}
