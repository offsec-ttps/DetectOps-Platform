"use client";
/**
 * Atomic Red Team index loader (CSV → typed objects).
 *
 * Behavior mirrors upstream atomicgen.io/src/hooks/useAtomicIndex.js:
 *   1. Fetch the canonical CSV from redcanaryco/atomic-red-team.
 *   2. Parse + validate headers (catch proxy / captive-portal HTML).
 *   3. Cache the parsed result module-globally (single fetch per page load).
 *   4. Expose tests + a deduped sorted technique list to consumers.
 */

import { useEffect, useState } from "react";

const INDEX_URL =
  "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/Indexes/Indexes-CSV/index.csv";

export interface AtomicIndexTest {
  tactic: string;
  tid: string;                       // T1003.001
  techName: string;                  // OS Credential Dumping: LSASS Memory
  testNum: string;
  testName: string;
  guid: string;
  exec: string;                      // executor name in lowercase
}

export interface AtomicIndexTechnique {
  id: string;
  name: string;
  label: string;                     // "T1003.001 - OS Credential Dumping: LSASS Memory"
}

export interface AtomicIndexData {
  tests: AtomicIndexTest[];
  techniques: AtomicIndexTechnique[];
}

let cache: AtomicIndexData | null = null;
let inflight: Promise<AtomicIndexData> | null = null;

// RFC-4180 lite — handles double-quote escapes + embedded commas.
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === ",") { out.push(cur); cur = ""; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

function parse(csv: string): AtomicIndexData {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const tests: AtomicIndexTest[] = [];
  const techMap = new Map<string, AtomicIndexTechnique>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const [tactic = "", tid = "", techName = "", testNum = "", testName = "", guid = "", exec = ""] = cols;
    if (!tid) continue;
    tests.push({ tactic, tid, techName, testNum, testName, guid, exec });
    if (!techMap.has(tid)) {
      techMap.set(tid, { id: tid, name: techName, label: `${tid} — ${techName}` });
    }
  }
  return {
    tests,
    techniques: [...techMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

const REQUIRED_HEADERS = ["Tactic", "Technique #", "Technique Name", "Test Name"];

function validate(text: string): void {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("The atomic-red-team index response was empty.");
  if (/^\s*<(?:!doctype|html|head|body|meta|script|title)\b/i.test(trimmed)) {
    throw new Error(
      "The atomic-red-team index endpoint returned HTML instead of CSV. " +
      "A proxy or captive portal is probably blocking raw.githubusercontent.com.",
    );
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const missing = REQUIRED_HEADERS.filter((h) => !firstLine.includes(h));
  if (missing.length) {
    throw new Error(`Index response missing expected header: ${missing.join(", ")}.`);
  }
}

async function fetchIndex(): Promise<AtomicIndexData> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const r = await fetch(INDEX_URL);
        if (!r.ok) throw new Error(`Atomic-red-team index fetch failed (HTTP ${r.status}).`);
        const text = await r.text();
        validate(text);
        const parsed = parse(text);
        if (parsed.tests.length === 0) throw new Error("Index parsed but contained no atomic tests.");
        cache = parsed;
        return parsed;
      } catch (e) {
        inflight = null;
        throw e;
      }
    })();
  }
  return inflight;
}

export default function useAtomicIndex() {
  const [data, setData] = useState<AtomicIndexData | null>(cache);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!cache);

  useEffect(() => {
    if (cache) { setData(cache); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchIndex()
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e: Error) => { if (!cancelled) { setError(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}

export function techniqueYamlUrl(tid: string): string {
  return `https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/${tid}/${tid}.yaml`;
}
