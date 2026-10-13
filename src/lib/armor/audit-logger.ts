/**
 * ArmorIQ Cryptographic Audit Logger (#1275)
 *
 * Routes ArmorIQ runtime gatekeeper and intent verification decisions directly
 * into SecureFlow's audit logging infrastructure, adding SOC 2, GDPR, and NIST
 * compliance mappings and cryptographic proof hashes.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface ArmorIQAuditLogEntry {
  userId?: string | null;
  agentId: string;
  action: string;
  decision: "ALLOW" | "BLOCK" | "HOLD";
  resource: string;
  reason: string;
  rule: string;
  proofHash: string;
  signature: string;
  intentId?: string;
  complianceFrameworks?: string[];
  metadata?: Record<string, unknown>;
}

export async function recordArmorIQAuditLog(entry: ArmorIQAuditLogEntry): Promise<void> {
  const frameworks = entry.complianceFrameworks ?? [
    "SOC 2 (CC6.1)",
    "GDPR (Art. 32)",
    "NIST SP 800-53 (AC-3, AU-2)",
  ];

  const auditMetadata = {
    isArmorIQ: true,
    agentId: entry.agentId,
    intentId: entry.intentId ?? null,
    rule: entry.rule,
    reason: entry.reason,
    proofHash: entry.proofHash,
    signature: entry.signature,
    complianceFrameworks: frameworks,
    tamperEvident: true,
    ...entry.metadata,
  };

  try {
    if (prisma && prisma.auditLog && typeof prisma.auditLog.create === "function") {
      await prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: `ARMORIQ_${entry.action.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`,
          resource: entry.resource,
          decision: entry.decision,
          metadata: auditMetadata,
        },
      });
    }
  } catch (err: any) {
    logger.warn("[ARMORIQ_AUDIT] Failed to persist audit log to database:", {
      error: err?.message || String(err),
      entry,
    });
  }

  logger.info(`[ARMORIQ_AUDIT] [${entry.decision}] ${entry.agentId} -> ${entry.action}`, {
    proofHash: entry.proofHash,
    rule: entry.rule,
  });
}
