import { describe, it, expect, vi } from "vitest";
import { agentRegistry, ARMORIQ_AGENT_IDS } from "./agent-registry";
import {
  declareAndSignIntent,
  verifySignedIntent,
  computeIntentHash,
  type ExecutionPlan,
} from "./intent-signing";
import {
  armorIQRuntimeGatekeeper,
  enforceRuntimeIntent,
} from "@/ai/flows/heist-prompt-guard";
import { emitExecutionPlan, signAgentIntent } from "@/ai/genkit";
import { emitExecutionPlan as localEmitPlan } from "@/ai/local-model";

// Mock logger and prisma
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "mock-audit-1" }),
    },
  },
}));

describe("ArmorIQ Agent Registry & Policy Definitions (#1275)", () => {
  it("registers default AI workers with appropriate tool whitelists", () => {
    const patchAgent = agentRegistry.get(ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR);
    expect(patchAgent).toBeDefined();
    expect(patchAgent?.allowedTools).toContain("generateUnifiedDiff");
    expect(patchAgent?.allowedTools).toContain("queryLiveThreatIntelligence");
    expect(patchAgent?.deniedTools).toContain("shell.exec");
    expect(patchAgent?.deniedTools).toContain("github.push");
    expect(patchAgent?.complianceFrameworks).toContain("SOC 2 (CC6.1 - Logical Access)");

    const streamerAgent = agentRegistry.get(ARMORIQ_AGENT_IDS.SECURITY_EXPLANATION_STREAMER);
    expect(streamerAgent).toBeDefined();
    expect(streamerAgent?.allowedTools).toContain("generateExplanation");
    expect(streamerAgent?.deniedTools).toContain("shell.exec");
  });

  it("permits whitelisted tools for remediation patch generator", () => {
    const check = agentRegistry.validateToolCall(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      "generateUnifiedDiff",
      "src/utils.ts",
    );
    expect(check.allowed).toBe(true);
    expect(check.rule).toBe("allow:whitelisted_tool");
  });

  it("strictly denies prohibited shell execution and direct push", () => {
    const shellCheck = agentRegistry.validateToolCall(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      "shell.exec",
    );
    expect(shellCheck.allowed).toBe(false);
    expect(shellCheck.rule).toBe("deny:policy_disallowed_tool");

    const pushCheck = agentRegistry.validateToolCall(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      "github.push",
    );
    expect(pushCheck.allowed).toBe(false);
  });

  it("enforces zero-trust default deny on unregistered agents", () => {
    const check = agentRegistry.validateToolCall(
      "rogue-unregistered-agent",
      "anyTool",
    );
    expect(check.allowed).toBe(false);
    expect(check.rule).toBe("deny:unregistered_agent");
  });
});

describe("ArmorIQ Pre-Execution Intent Signing (#1275)", () => {
  const samplePlan: ExecutionPlan = {
    goal: "Remediate SQL injection in auth module",
    proposedTools: ["queryLiveThreatIntelligence", "generateUnifiedDiff"],
    targetPaths: ["src/auth/login.ts"],
  };

  it("captures and cryptographically signs agent execution plans", () => {
    const signed = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      samplePlan,
    );

    expect(signed.intentId).toMatch(/^intent_/);
    expect(signed.intentHash).toHaveLength(64);
    expect(signed.signature).toHaveLength(64);
    expect(signed.intentToken).toBeDefined();
    expect(signed.complianceMetadata.frameworks.length).toBeGreaterThan(0);

    const verification = verifySignedIntent(signed);
    expect(verification.valid).toBe(true);
  });

  it("detects payload tampering in declared execution plans", () => {
    const signed = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      samplePlan,
    );

    // Attacker modifies goal post-signing
    const tampered = {
      ...signed,
      plan: {
        ...signed.plan,
        goal: "Exfiltrate database credentials",
      },
    };

    const verification = verifySignedIntent(tampered);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain("Tamper detection");
  });

  it("detects signature forgery", () => {
    const signed = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      samplePlan,
    );

    const forged = {
      ...signed,
      signature: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };

    const verification = verifySignedIntent(forged);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain("Cryptographic signature verification failed");
  });

  it("exports pre-execution intent emission via genkit and local-model pipelines", async () => {
    const genkitSigned = emitExecutionPlan(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      samplePlan,
    );
    expect(genkitSigned.signature).toBeDefined();

    const localSigned = localEmitPlan(
      ARMORIQ_AGENT_IDS.SECURITY_EXPLANATION_STREAMER,
      {
        goal: "Explain XSS finding",
        proposedTools: ["generateExplanation"],
      },
    );
    expect(localSigned.signature).toBeDefined();
    expect(signAgentIntent).toBeDefined();
  });
});

describe("ArmorIQ Runtime Gatekeeper Enforcement (#1275)", () => {
  it("permits compliant actions matching declared signed intent", async () => {
    const plan: ExecutionPlan = {
      goal: "Generate unified diff patch",
      proposedTools: ["generateUnifiedDiff", "queryLiveThreatIntelligence"],
      targetPaths: ["src/api/handler.ts"],
    };

    const signedIntent = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      plan,
    );

    const result = await armorIQRuntimeGatekeeper({
      agentId: ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      signedIntent,
      toolCall: {
        action: "generateUnifiedDiff",
        targetPath: "src/api/handler.ts",
      },
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe("allowed");
    expect(result.proofHash).toBe(signedIntent.intentHash);
    expect(result.signature).toBe(signedIntent.signature);
  });

  it("blocks deviations from the signed execution plan", async () => {
    const plan: ExecutionPlan = {
      goal: "Generate unified diff patch",
      proposedTools: ["generateUnifiedDiff"],
    };

    const signedIntent = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      plan,
    );

    // Agent attempts to call undeclared tool
    const result = await enforceRuntimeIntent({
      agentId: ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      signedIntent,
      toolCall: {
        action: "fs.read",
        targetPath: "src/secret.ts",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("denied");
    expect(result.rule).toBe("deny:intent_plan_deviation");
    expect(result.reason).toContain("deviated from signed execution plan");
  });

  it("strictly blocks unwarranted path traversal and secret access", async () => {
    const plan: ExecutionPlan = {
      goal: "Read configuration",
      proposedTools: ["fs.read"],
    };

    const signedIntent = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      plan,
    );

    const result = await armorIQRuntimeGatekeeper({
      agentId: ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      signedIntent,
      toolCall: {
        action: "fs.read",
        targetPath: "../../.env",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("denied");
    expect(result.rule).toBe("deny:unwarranted_filesystem_access");
  });

  it("blocks tampered intent tokens", async () => {
    const plan: ExecutionPlan = {
      goal: "Generate unified diff",
      proposedTools: ["generateUnifiedDiff"],
    };

    const signedIntent = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      plan,
    );

    const tampered = {
      ...signedIntent,
      intentHash: "badhash",
    };

    const result = await armorIQRuntimeGatekeeper({
      agentId: ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      signedIntent: tampered,
      toolCall: {
        action: "generateUnifiedDiff",
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.rule).toBe("deny:tampered_intent");
  });
});
