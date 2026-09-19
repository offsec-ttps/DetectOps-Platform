/**
 * Backstop poller.
 *
 * Catches rows that should have been enqueued by post-sync hooks but
 * weren't — sync started but server crashed before `enqueueAfterSync` ran,
 * a row was inserted outside the standard pipeline, etc.
 *
 * Cheap: one query per source kind for any row created in the lookback
 * window. The actual dedupe lives in `enqueuePackJob` via the unique key.
 */

import { enqueueAfterSync, type SourceKind } from "./enqueue";
import { logEvent } from "@/lib/event-log";

const DEFAULT_LOOKBACK_MIN = 60;
const SOURCES: SourceKind[] = ["ti", "sigmahq", "elastic", "splunk", "community-rule"];

export interface BackstopResult {
  lookbackMin: number;
  perSource: Array<{ source: SourceKind; scanned: number; enqueued: number; skipped: number }>;
  totalEnqueued: number;
}

export async function runBackstop({ lookbackMin = DEFAULT_LOOKBACK_MIN }: { lookbackMin?: number } = {}): Promise<BackstopResult> {
  const since = new Date(Date.now() - lookbackMin * 60_000);
  const perSource: BackstopResult["perSource"] = [];
  let totalEnqueued = 0;
  for (const source of SOURCES) {
    try {
      const r = await enqueueAfterSync({ source, since, silent: true });
      perSource.push(r);
      totalEnqueued += r.enqueued;
    } catch (err) {
      // Tolerate per-source errors — one broken table shouldn't kill the sweep
      perSource.push({ source, scanned: 0, enqueued: 0, skipped: 0 });
      void logEvent({
        category: "detection-pack",
        action: "detection-pack.backstop.error",
        actor: "system", status: "error",
        message: `backstop ${source}: ${(err as Error).message?.slice(0, 200)}`,
      });
    }
  }
  if (totalEnqueued > 0) {
    void logEvent({
      category: "detection-pack",
      action: "detection-pack.backstop.enqueued",
      actor: "system", status: "info",
      message: `backstop enqueued ${totalEnqueued} since ${since.toISOString()}`,
      details: { lookbackMin, perSource },
    });
  }
  return { lookbackMin, perSource, totalEnqueued };
}
