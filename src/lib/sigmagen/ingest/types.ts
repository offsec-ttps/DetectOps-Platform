/**
 * SigmaGen ingestion types.
 *
 * Every input (URL, PDF, docx, txt, IOC paste, free text) is normalized into a
 * single `NormalizedInput` shape that the multi-agent pipeline consumes. This
 * keeps the intel-extract agent source-agnostic — it always sees clean text +
 * pre-extracted IOCs + discovered references.
 */

export type IngestKind = "url" | "pdf" | "docx" | "txt" | "ioc" | "text";

/** Hard cap on extracted text fed downstream — keeps prompt tokens bounded. */
export const MAX_TEXT_CHARS = 40_000;

export interface ExtractedIocs {
  ipv4: string[];
  ipv6: string[];
  domain: string[];
  url: string[];
  md5: string[];
  sha1: string[];
  sha256: string[];
  cve: string[];
  email: string[];
}

export function emptyIocs(): ExtractedIocs {
  return { ipv4: [], ipv6: [], domain: [], url: [], md5: [], sha1: [], sha256: [], cve: [], email: [] };
}

export function iocCount(i: ExtractedIocs): number {
  return Object.values(i).reduce((n, arr) => n + arr.length, 0);
}

export interface NormalizedReference {
  title: string;
  url: string;
  type: string;                 // report | blog | advisory | community | vendor | other
}

export interface NormalizedInput {
  kind: IngestKind;
  title: string;
  /** Cleaned main text, truncated to MAX_TEXT_CHARS. */
  text: string;
  charCount: number;
  iocs: ExtractedIocs;
  /** Outbound links discovered in the source (URL ingestion) + the source URL itself. */
  references: NormalizedReference[];
  /** Source-specific metadata (page count, source url, byte size, …). */
  meta: Record<string, unknown>;
}

/** Raw request the dispatcher accepts. Exactly one content source should be set. */
export interface IngestRequest {
  kind?: IngestKind;
  url?: string;
  text?: string;
  /** Uploaded file bytes (PDF / docx / txt). */
  fileBuffer?: Buffer;
  fileName?: string;
  mimeType?: string;
}
