/**
 * Collection worker — single-iteration tick() (mirrors detection-packs worker).
 * A mutex prevents overlapping collections; a cron/route calls tick() on an
 * interval, plus a manual "Collect now" path calls runCollection() directly.
 */

import { isIntelEnabled } from "./flags";
import { runCollection } from "./registry";

let running = false;

export async function tick(): Promise<{ ran: boolean; reason?: string; result?: Awaited<ReturnType<typeof runCollection>> }> {
  if (!isIntelEnabled()) return { ran: false, reason: "ransomware-intel disabled" };
  if (running) return { ran: false, reason: "collection already running" };
  running = true;
  try {
    const result = await runCollection();
    return { ran: true, result };
  } finally {
    running = false;
  }
}
