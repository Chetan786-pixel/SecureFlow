import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchArmorIQAuditTraces,
  recordArmorIQAuditLog,
  buildComplianceReport,
  verifyArmorIQAuditResourceOwnership,
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

  if ((session.user as any)?.role === "SUSPENDED" || (session.user as any)?.forbidden) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const scanJobId = searchParams.get("scanJobId") || undefined;
    const findingId = searchParams.get("findingId") || undefined;
    const decision = searchParams.get("decision") || undefined;
    const format = searchParams.get("format") || undefined;
    const framework = (searchParams.get("framework") as "SOC2" | "ISO27001" | "ALL") || "ALL";

    const { traces, total } = await fetchArmorIQAuditTraces({
      userId: session.user.id,
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
  } catch (error: any) {
    if (
      error?.status === 503 ||
      error?.status === 504 ||
      error?.name === "ArmorIQTimeoutError" ||
      error?.name === "ArmorIQUnreachableError" ||
      error?.code === "ETIMEDOUT" ||
      error?.code === "ENOTFOUND"
    ) {
      return NextResponse.json(
        { error: "Upstream ArmorIQ audit service is temporarily unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Failed to retrieve ArmorIQ audit traces" }, { status: 500 });
  }
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

  if ((session.user as any)?.role === "SUSPENDED" || (session.user as any)?.forbidden) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    if (!agentId || !toolName || !decision || !["ALLOW", "BLOCK", "HOLD"].includes(decision)) {
      return NextResponse.json(
        { error: "agentId, toolName, and decision ('ALLOW' | 'BLOCK' | 'HOLD') are required." },
        { status: 400 },
      );
    }

    const ownsReferencedResource = await verifyArmorIQAuditResourceOwnership({
      userId: session.user.id,
      scanJobId,
      findingId,
    });
    if (!ownsReferencedResource) {
      // 404 avoids confirming whether the guessed ID exists for another tenant.
      return NextResponse.json({ error: "Scan job or finding not found" }, { status: 404 });
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

    if (!log) {
      return NextResponse.json(
        { error: "Failed to record ArmorIQ enforcement audit log" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, log }, { status: 201 });
  } catch (error: any) {
    if (error?.status === 502 || error?.code === "BAD_GATEWAY") {
      return NextResponse.json(
        { error: "Upstream ArmorIQ service returned an invalid gateway response" },
        { status: 502 },
      );
    }
    if (
      error?.status === 503 ||
      error?.status === 504 ||
      error?.name === "ArmorIQTimeoutError" ||
      error?.name === "ArmorIQUnreachableError" ||
      error?.code === "ETIMEDOUT" ||
      error?.code === "ENOTFOUND" ||
      error?.message?.toLowerCase().includes("timeout") ||
      error?.message?.toLowerCase().includes("unreachable")
    ) {
      return NextResponse.json(
        { error: "Upstream ArmorIQ verification service is temporarily unreachable" },
        { status: 503 },
      );
    }
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
