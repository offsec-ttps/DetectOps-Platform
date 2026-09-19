import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { clearSessionCookie, getSessionUser } from "@/lib/auth";
import { logEvent } from "@/lib/event-log";

const SESSION_COOKIE = "do_session";

export async function POST() {
  const user = await getSessionUser().catch(() => null);
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.authSession.deleteMany({ where: { token } }).catch(() => {});
  }
  await clearSessionCookie();
  void logEvent({
    category: "auth", action: "auth.logout",
    actor: user?.email || "anonymous", status: "ok",
    targetType: user ? "user" : undefined, targetId: user?.id,
  });
  return NextResponse.json({ status: "ok", redirect: "/" });
}
