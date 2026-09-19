/**
 * Workspace audit log helper.
 *
 * Centralizes writes to the WorkspaceAudit table so every workspace mutation
 * (draft create/update/delete, PR open, source rollback, scheduled refresh)
 * lands in one place for forensics. Phase 8 lean implementation — best-effort
 * persistence, never throws.
 */

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/event-log";

export interface AuditEvent {
  actor?: string;
  action: string;            // dotted: draft.create, draft.update, source.refresh, …
  targetType: string;        // draft | source | rule
  targetId?: string | null;
  details?: Record<string, unknown>;
  success?: boolean;
  errorMessage?: string;
}

export async function logWorkspaceAudit(ev: AuditEvent): Promise<void> {
  try {
    await prisma.workspaceAudit.create({
      data: {
        actor: ev.actor ?? "system",
        action: ev.action,
        targetType: ev.targetType,
        targetId: ev.targetId ?? null,
        details: JSON.stringify(ev.details ?? {}),
        success: ev.success ?? true,
        errorMessage: ev.errorMessage ?? null,
      },
    });
  } catch {
    // Audit is best-effort. We never want a missing audit row to break a
    // user-facing action. The action that triggered this call still succeeds.
  }
  // Mirror to the unified EventLog so the /api/events feed and JSONL file
  // also capture workspace actions. Best-effort.
  void logEvent({
    category: "workspace",
    action: ev.action,
    actor: ev.actor ?? "system",
    status: ev.success === false ? "error" : "ok",
    targetType: ev.targetType,
    targetId: ev.targetId,
    message: ev.errorMessage ?? "",
    details: ev.details ?? {},
    errorMessage: ev.errorMessage ?? null,
  });
}
