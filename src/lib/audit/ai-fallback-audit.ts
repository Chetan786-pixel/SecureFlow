import { sanitizeAuditLogInput } from "@/lib/audit/minimization";

export type AiFallbackReason = "rate_limit" | "timeout";

/**
 * Records that the AI orchestration switched to a fallback model (#1233).
 *
 * Fire-and-forget: an audit-sink failure must never break an AI call.
 * Only model ids and the reason are stored. Never the prompt or code snippet.
 */
export async function recordAiFallbackEvent(event: {
  fromModel: string;
  toModel: string;
  reason: AiFallbackReason;
}): Promise<void> {
  try {
    const { default: prisma } = await import("@/lib/prisma");
    await prisma.auditLog.create({
      data: sanitizeAuditLogInput({
        userId: null,
        action: "AI Model Fallback",
        resource: `${event.fromModel} -> ${event.toModel}`,
        decision: event.reason,
        metadata: { ...event },
      }),
    });
  } catch (err) {
    console.warn("[AI_FALLBACK_AUDIT] Failed to write audit event:", err);
  }
}
