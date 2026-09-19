/**
 * GET|POST /api/ransomware-intel/collect/tick — worker tick for a cron/scheduler.
 * Mutex-guarded; safe to call on an interval.
 */

import { NextResponse } from "next/server";
import { tick } from "@/lib/ransomware-intel/worker";

export async function POST() { return NextResponse.json(await tick()); }
export async function GET() { return NextResponse.json(await tick()); }
