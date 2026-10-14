import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchArmorIQAuditTraces,
  recordArmorIQAuditLog,
  buildComplianceReport,
} from "@/lib/armor/audit-integration";
import { withRateLimit, TIERS } from "@/lib/middleware/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/audit/armoriq
 *
 * Retrieves enforcement metadata and policy decisions from ArmorIQ
 * linked to CI/CD scan jobs and security findings with privacy preservation.
 */
async function getHandler(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scanJobId = searchParams.get("scanJobId") || undefined;
  const findingId = searchParams.get("findingId") || undefined;
  const decision = searchParams.get("decision") || undefined;
  const format = searchParams.get("format") || undefined;
  const framework = (searchParams.get("framework") as "SOC2" | "ISO27001" | "ALL") || "ALL";

  const { traces, total } = await fetchArmorIQAuditTraces({
    scanJobId,
    findingId,
    decision,
    limit: 100,
  });

  if (format === "compliance") {
    const report = buildComplianceReport(traces, framework);
    return NextResponse.json({
      framework,
      generatedAt: new Date().toISOString(),
      totalRecords: total,
      evidence: report,
    });
  }

  return NextResponse.json({
    traces,
    total,
  });
}

/**
 * POST /api/audit/armoriq
 *
 * Ingests an ArmorIQ tool execution verification proof and links it
 * to a CI/CD scan job or finding.
 */
async function postHandler(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      scanJobId,
      findingId,
      agentId,
      toolName,
      decision,
      ruleMatched,
      justification,
      proofHash,
      signature,
      intentId,
      frameworks,
    } = body;

    if (!agentId || !toolName || !decision) {
      return NextResponse.json(
        { error: "agentId, toolName, and decision ('ALLOW' | 'BLOCK' | 'HOLD') are required." },
        { status: 400 },
      );
    }

    const log = await recordArmorIQAuditLog({
      scanJobId,
      findingId,
      agentId,
      toolName,
      decision,
      ruleMatched,
      justification,
      proofHash,
      signature,
      intentId,
      frameworks,
      userId: session.user.id,
    });

    return NextResponse.json({ success: true, log });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to record ArmorIQ enforcement audit log" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(
  getHandler as (req: NextRequest, ...args: unknown[]) => Promise<NextResponse>,
  { ...TIERS.STANDARD, keyPrefix: "audit:armoriq" },
);

export const POST = withRateLimit(
  postHandler as (req: NextRequest, ...args: unknown[]) => Promise<NextResponse>,
  { ...TIERS.STANDARD, keyPrefix: "audit:armoriq:post" },
);
