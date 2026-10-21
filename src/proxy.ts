/**
 * Global authentication gate (Next.js 16 proxy — formerly middleware).
 *
 * Why: route handlers historically opted in to auth one by one (`requireUser()`),
 * and ~half of them never did — C2 control, VM control, terminal sessions, the
 * cloud-lab proxy, sync jobs… With no global gate those were reachable anonymously
 * in production. This proxy makes authentication the DEFAULT: when auth is enforced
 * (production, or AUTH_ENFORCE=1 — see lib/auth-guard.ts) every /api route needs a
 * valid, unexpired session unless it is on the explicit allowlist below, and
 * dashboard pages redirect to /login. Dev mode (enforcement off) is unchanged.
 *
 * In-route checks (requireUser/requireRole/ownsOr404) still apply on top — this is
 * defence in depth, not a replacement for per-resource authorization.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authEnforced } from "@/lib/auth-guard";

const SESSION_COOKIE = "do_session";

// API routes reachable WITHOUT a browser session. Each one authenticates the
// caller itself (verified during the security review) or is deliberately public:
//   /api/auth/*                 login / signup / verify / resend / logout / me
//   /api/mcp                    MCP endpoint — requireMcpApiKey (scoped, rate-limited)
//   /api/ransomware-intel/v1/*  public intel API — requireIntelApiKey
//   /api/v1/*                   fleet-agent protocol — enrollment token / node API key
//                               (agent installer + manifest are public by design)
// /api/ti-watcher/scan authenticates itself (WATCHER_TOKEN bearer for the cron, or an admin session).
const PUBLIC_API_EXACT = new Set<string>(["/api/mcp", "/api/ti-watcher/scan"]);
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/ransomware-intel/v1/", "/api/v1/"];

// Pages reachable without a session.
const PUBLIC_PAGES = new Set<string>(["/", "/login", "/signup", "/verify"]);

function isPublicApi(path: string): boolean {
  if (PUBLIC_API_EXACT.has(path)) return true;
  return PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
}

// Short-lived positive cache so a page that fires many API calls doesn't hit the
// DB for each one. Negative results are never cached; logout deletes the session
// row, so a revoked token stops working within CACHE_MS at most.
const CACHE_MS = 30_000;
const cache = new Map<string, number>(); // token → valid-until (ms)

async function hasValidSession(token: string | undefined): Promise<boolean> {
  if (!token || token.length < 20 || token.length > 200) return false;
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit > now) return true;
  const s = await prisma.authSession.findUnique({ where: { token }, select: { expiresAt: true } }).catch(() => null);
  if (!s || s.expiresAt.getTime() <= now) { cache.delete(token); return false; }
  if (cache.size > 5000) cache.clear();
  cache.set(token, Math.min(now + CACHE_MS, s.expiresAt.getTime()));
  return true;
}

export async function proxy(req: NextRequest) {
  if (!authEnforced()) return NextResponse.next();
  const path = req.nextUrl.pathname;

  if (path.startsWith("/api/")) {
    if (req.method === "OPTIONS" || isPublicApi(path)) return NextResponse.next();
    if (await hasValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (PUBLIC_PAGES.has(path)) return NextResponse.next();
  if (await hasValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const login = new URL("/login", req.url);
  login.searchParams.set("next", path + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|brand/|icon.png|favicon.ico|robots.txt|sitemap.xml).*)"],
};
