/**
 * Ingestion dispatcher — normalises any SigmaGen input into a NormalizedInput.
 *
 *   normalizeInput({ url })                       → fetch + Readability
 *   normalizeInput({ fileBuffer, fileName, mime }) → pdf | docx | txt by type
 *   normalizeInput({ text })                       → free text / IOC paste
 *
 * Also exposes `buildDigest()` which renders a NormalizedInput (optionally with
 * retrieved related-intel excerpts) into the text block the pipeline stores on
 * SigmaGenRun.normalizedText and feeds to the intel-extract agent.
 */

import { type NormalizedInput, type IngestRequest } from "./types";
import { normalizeText } from "./text";
import { normalizeUrl } from "./url";
import { normalizePdf } from "./pdf";
import { normalizeDocx } from "./docx";
import { summariseIocs } from "./ioc";
import { stripInvisible } from "../guardrails";

export * from "./types";
export { extractIocs, summariseIocs, refang } from "./ioc";
export { fetchAndExtract } from "./url";

function detectFileKind(fileName = "", mimeType = ""): "pdf" | "docx" | "txt" {
  const n = fileName.toLowerCase();
  const m = mimeType.toLowerCase();
  if (m.includes("pdf") || n.endsWith(".pdf")) return "pdf";
  if (m.includes("wordprocessingml") || m.includes("msword") || n.endsWith(".docx") || n.endsWith(".doc")) return "docx";
  return "txt";
}

/** Sanitise normalized output: strip invisible / smuggling characters from
 *  title + text before any LLM sees them. Records the count in meta. */
function sanitizeNormalized(n: NormalizedInput): NormalizedInput {
  const t = stripInvisible(n.text);
  const title = stripInvisible(n.title);
  return { ...n, text: t.text, title: title.text, meta: { ...n.meta, strippedChars: t.removed + title.removed } };
}

export async function normalizeInput(req: IngestRequest): Promise<NormalizedInput> {
  return sanitizeNormalized(await rawNormalizeInput(req));
}

async function rawNormalizeInput(req: IngestRequest): Promise<NormalizedInput> {
  // 1. Explicit / detected URL
  const trimmedText = (req.text || "").trim();
  if (req.url || req.kind === "url") {
    const url = (req.url || trimmedText).trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("A valid http(s) URL is required for URL ingestion.");
    return normalizeUrl(url);
  }

  // 2. Uploaded file
  if (req.fileBuffer && req.fileBuffer.length) {
    const fileKind = detectFileKind(req.fileName, req.mimeType);
    if (fileKind === "pdf") return normalizePdf(req.fileBuffer, req.fileName);
    if (fileKind === "docx") return normalizeDocx(req.fileBuffer, req.fileName);
    // txt file → decode and treat as text
    return normalizeText(req.fileBuffer.toString("utf-8"), { kind: "txt", title: req.fileName });
  }

  // 3. Bare URL pasted as text
  if (/^https?:\/\/\S+$/i.test(trimmedText)) {
    return normalizeUrl(trimmedText);
  }

  // 4. Free text / IOC paste
  if (!trimmedText) throw new Error("No input provided. Supply a URL, a file, or text.");
  return normalizeText(trimmedText, { kind: req.kind === "ioc" ? "ioc" : undefined });
}

/** A flat IOC block for inclusion in the digest. */
function iocBlock(input: NormalizedInput): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input.iocs)) {
    if (v.length) lines.push(`  ${k}: ${(v as string[]).slice(0, 25).join(", ")}${v.length > 25 ? ` … (+${v.length - 25})` : ""}`);
  }
  return lines.length ? lines.join("\n") : "  (none extracted)";
}

export interface RelatedDoc {
  title: string;
  url: string;
  excerpt: string;
}

/**
 * Render the digest stored on SigmaGenRun.normalizedText. Includes the source
 * text, extracted IOCs, and any retrieved related-intel excerpts.
 */
export function buildDigest(input: NormalizedInput, related: RelatedDoc[] = []): string {
  const parts: string[] = [
    `Source: ${input.title} (${input.kind})`,
    `Extracted IOCs (${summariseIocs(input.iocs)}):\n${iocBlock(input)}`,
    `Primary content:\n${input.text}`,
  ];
  if (related.length) {
    const relText = related
      .map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.excerpt.slice(0, 1500)}`)
      .join("\n\n");
    parts.push(`Related threat intelligence (retrieved):\n${relText}`);
  }
  return parts.join("\n\n");
}
