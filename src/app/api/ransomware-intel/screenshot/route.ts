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

const RASTER = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif"]);
const MAX_BYTES = 10 * 1024 * 1024;

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
    // redirect:"manual" — an allowlisted host must not bounce us elsewhere.
    const res = await fetch(url.toString(), { signal: ctrl.signal, redirect: "manual", headers: { "User-Agent": "detectops-ransomware-intel/1.0" } });
    clearTimeout(to);
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    const ct = (res.headers.get("content-type") || "image/png").split(";")[0].trim().toLowerCase();
    // Raster formats only: anyone can host an SVG on raw.githubusercontent.com,
    // and SVG served from our origin is script-capable (stored XSS).
    if (!RASTER.has(ct)) return NextResponse.json({ error: "not a raster image" }, { status: 415 });
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return NextResponse.json({ error: "image too large" }, { status: 413 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return NextResponse.json({ error: "image too large" }, { status: 413 });
    return new NextResponse(buf, { headers: {
      "Content-Type": ct, "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 502 });
  }
}
