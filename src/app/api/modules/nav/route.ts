/**
 * GET /api/modules/nav — nav entries contributed by live modules, for the
 * registry-aware sidebar. Icons are sent as lucide-react icon names (string);
 * the client maps them to components.
 */

import { NextResponse } from "next/server";
import { getModuleNav } from "@/lib/modules/registry";

export async function GET() {
  try {
    const items = await getModuleNav();
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
