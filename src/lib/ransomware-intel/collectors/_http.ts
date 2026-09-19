/**
 * Small fetch helper for collectors: timeout + bounded retry on network/5xx/429.
 * (community-sources/_common.ts only exports hashContent + GitHub-specific
 * fetchers, so we keep a tiny generic one here.)
 */

export async function fetchJson<T = any>(url: string, opts: { timeoutMs?: number; attempts?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const { timeoutMs = 20_000, attempts = 3, headers = {} } = opts;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "detectops-ransomware-intel/1.0", ...headers }, signal: ctrl.signal });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, Math.min(6000, 500 * 2 ** i)));
    } finally {
      clearTimeout(to);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
