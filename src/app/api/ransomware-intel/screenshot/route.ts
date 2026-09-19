/**
 * GET /api/ransomware-intel/screenshot?ref=<url> — proxy/stream a leak-site
 * screenshot from an allowlisted host (avoids hotlinking + arbitrary image
 * domains in next.config). Returns the image bytes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";

const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "api.ransomware.live",
  "images.ransomware.live",
  "www.ransomlook.io",
  "ransomlook.io",
]);

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const ref = req.nextUrl.searchParams.get("ref") || "";
  let url: URL;
  try { url = new URL(ref); } catch { return NextResponse.json({ error: "invalid ref" }, { status: 400 }); }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    return NextResponse.json({ error: "host not allowlisted" }, { status: 400 });
  }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url.toString(), { signal: ctrl.signal, headers: { "User-Agent": "detectops-ransomware-intel/1.0" } });
    clearTimeout(to);
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    const ct = res.headers.get("content-type") || "image/png";
    if (!ct.startsWith("image/")) return NextResponse.json({ error: "not an image" }, { status: 415 });
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 502 });
  }
}
