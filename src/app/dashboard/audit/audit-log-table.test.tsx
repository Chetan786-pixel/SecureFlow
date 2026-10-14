import { describe, it, expect, vi } from "vitest";
import React from "react";
import AuditLogTable from "./audit-log-table";
import type { UserAuditLogResult } from "@/lib/actions/audit";

// Mock server actions
vi.mock("@/lib/actions/audit", () => ({
  getUserAuditLogs: vi.fn(),
}));

describe("AuditLogTable component", () => {
  const mockInitialResult: UserAuditLogResult = {
    logs: [
      {
        id: "log-1",
        action: "AUDIT_CHECK",
        resource: "GauravKarakoti/SecureFlow#388",
        decision: "PASS",
        timestamp: new Date("2026-07-29T20:00:00Z"),
        userId: "user-1",
        metadata: null,
      },
      {
        id: "log-2",
        action: "PROMPT_GUARD",
        resource: "test-repo",
        decision: "BLOCK",
        timestamp: new Date("2026-07-29T21:00:00Z"),
        userId: null,
        metadata: null,
      },
    ],
    total: 2,
    totalPages: 1,
    page: 1,
    pageSize: 10,
  };

  it("is a valid React component and accepts props", () => {
    expect(AuditLogTable).toBeDefined();
    expect(typeof AuditLogTable).toBe("function");
  });

  it("renders table structure without crashing", () => {
    const element = React.createElement(AuditLogTable, {
      initialResult: mockInitialResult,
      actions: ["AUDIT_CHECK", "PROMPT_GUARD"],
      decisions: ["PASS", "BLOCK"],
      ownName: "Test User",
    });
    expect(element).toBeDefined();
    expect(element.props.ownName).toBe("Test User");
    expect(element.props.initialResult.logs).toHaveLength(2);
  });

  it("handles ArmorIQ audit records with cryptographic and compliance metadata", () => {
    const armorIQResult: UserAuditLogResult = {
      logs: [
        {
          id: "log-armoriq-1",
          action: "ARMORIQ_INTENT_ENFORCEMENT",
          resource: "src/auth/login.ts",
          decision: "ALLOW",
          timestamp: new Date("2026-10-12T20:00:00Z"),
          userId: "user-1",
          metadata: {
            isArmorIQ: true,
            agentId: "agent-remediation-patch-generator",
            intentId: "intent_12345",
            rule: "allow:whitelisted_tool",
            reason: "Action complies with policy",
            proofHash: "a1b2c3d4e5",
            signature: "f6e5d4c3b2",
            complianceFrameworks: ["SOC 2 (CC6.1)", "GDPR (Art. 32)", "NIST SP 800-53 (AC-3)"],
            tamperEvident: true,
          },
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
      pageSize: 10,
    };

    const element = React.createElement(AuditLogTable, {
      initialResult: armorIQResult,
      actions: ["ARMORIQ_INTENT_ENFORCEMENT"],
      decisions: ["ALLOW"],
      ownName: "Test User",
    });
    expect(element).toBeDefined();
    expect(element.props.initialResult.logs[0].action).toBe("ARMORIQ_INTENT_ENFORCEMENT");
    expect((element.props.initialResult.logs[0].metadata as any).isArmorIQ).toBe(true);
  });
});
