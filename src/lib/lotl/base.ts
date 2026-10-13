/**
 * BaseIngestor — ported from magicsword-io/Magic-Atomics
 * backend/app/ingestion/base.py.
 *
 * To add a new LOL data source:
 *   1. Create a class implementing LotlIngestor.
 *   2. Declare its metadata (sourceId, repo, branch, platform, …).
 *   3. Implement collect() → NormalizedEntry[].
 *   4. Register it in registry.ts.
 *
 * Unlike the Python original (which git-clones each repo and reads local
 * files), collect() fetches over the GitHub API using the helpers in
 * github.ts — or, for sources that synthesize tests from a hardcoded tool
 * list (e.g. Sysinternals), returns entries directly without any fetch.
 * Each entry's `sourceRef` must be unique within the library.
 */

import type { NormalizedEntry } from "./types";

export interface LotlIngestor {
  /** Unique identifier, e.g. "lolbas". */
  readonly sourceId: string;
  /** Human-readable name, e.g. "LOLBAS". */
  readonly displayName: string;
  readonly description: string;
  /** "owner/repo" on GitHub, or "" for synthesized sources. */
  readonly repo: string;
  readonly branch: string;
  readonly repoUrl: string;
  /** Primary platform: "windows" | "linux" | "macos" | "multi". */
  readonly platform: string;

  /** Gather all normalized entries for this library. */
  collect(): Promise<NormalizedEntry[]>;
}
