/**
 * Next.js server-boot hook (runs once when the server starts).
 * Auto-starts the content-sync scheduler so enabled jobs in config/sync-jobs.json
 * run on schedule without any manual trigger. No-op on the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureSyncScheduler } = await import("@/lib/sync/scheduler");
    ensureSyncScheduler();
  } catch { /* never block boot on the scheduler */ }
}
