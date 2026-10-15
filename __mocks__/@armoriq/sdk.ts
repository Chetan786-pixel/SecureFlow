/**
 * Mock ArmorIQ SDK Module (Security Audit Cleaned - #1335)
 *
 * This mock contains purely synthetic test fixtures to simulate ArmorIQ runtime policy
 * decisions, cryptographic intent signature validation, proof verification, and upstream
 * timeouts/unreachable gateway errors without hardcoded live production credentials.
 */
import { vi } from "vitest";

/** Safe synthetic API key placeholder for ArmorIQ tests. */
export const SAFE_MOCK_ARMORIQ_API_KEY = "armoriq_mock_test_key_safe";
export const SAFE_MOCK_INTENT_TOKEN = "intent_mock_token_safe_never_leak";

/**
 * Custom Error thrown when upstream ArmorIQ service times out.
 */
export class ArmorIQTimeoutError extends Error {
  public readonly code = "ETIMEDOUT";
  public readonly status = 504;
  constructor(message = "ArmorIQ policy verification timed out after 15000ms") {
    super(message);
    this.name = "ArmorIQTimeoutError";
  }
}

/**
 * Custom Error thrown when upstream ArmorIQ gateway is unreachable.
 */
export class ArmorIQUnreachableError extends Error {
  public readonly code = "ENOTFOUND";
  public readonly status = 503;
  constructor(message = "Upstream ArmorIQ verification gateway is unreachable") {
    super(message);
    this.name = "ArmorIQUnreachableError";
  }
}

export class ArmorIQError extends Error {
  public readonly status = 500;
  constructor(message = "ArmorIQ internal error") {
    super(message);
    this.name = "ArmorIQError";
  }
}

/**
 * Configurable simulation state for ArmorIQ SDK mocks.
 */
export const mockArmorIQState = {
  decision: "ALLOW" as "ALLOW" | "BLOCK" | "HOLD",
  ruleMatched: "DEFAULT_ZERO_TRUST_POLICY",
  justification: "Action permitted under verified developer scope",
  validProof: true,
  validSignature: true,
  shouldTimeout: false,
  shouldFailUnreachable: false,
  timeoutMs: 15_000,
};

export function setMockArmorIQDecision(
  decision: "ALLOW" | "BLOCK" | "HOLD",
  ruleMatched = "RULE_SPECIFIED",
  justification = "Policy decision applied",
) {
  mockArmorIQState.decision = decision;
  mockArmorIQState.ruleMatched = ruleMatched;
  mockArmorIQState.justification = justification;
}

export function setMockArmorIQTimeout(shouldTimeout: boolean) {
  mockArmorIQState.shouldTimeout = shouldTimeout;
}

export function setMockArmorIQUnreachable(shouldFail: boolean) {
  mockArmorIQState.shouldFailUnreachable = shouldFail;
}

export function setMockArmorIQProofValidity(valid: boolean) {
  mockArmorIQState.validProof = valid;
  mockArmorIQState.validSignature = valid;
}

export function resetMockArmorIQ() {
  mockArmorIQState.decision = "ALLOW";
  mockArmorIQState.ruleMatched = "DEFAULT_ZERO_TRUST_POLICY";
  mockArmorIQState.justification = "Action permitted under verified developer scope";
  mockArmorIQState.validProof = true;
  mockArmorIQState.validSignature = true;
  mockArmorIQState.shouldTimeout = false;
  mockArmorIQState.shouldFailUnreachable = false;
  mockArmorIQState.timeoutMs = 15_000;
}

export const mockVerifyIntentToken = vi.fn().mockImplementation(async (token: string) => {
  if (mockArmorIQState.shouldTimeout) {
    throw new ArmorIQTimeoutError();
  }
  if (mockArmorIQState.shouldFailUnreachable) {
    throw new ArmorIQUnreachableError();
  }
  return {
    allowed: mockArmorIQState.decision === "ALLOW",
    decision: mockArmorIQState.decision,
    ruleMatched: mockArmorIQState.ruleMatched,
    justification: mockArmorIQState.justification,
    proofHash: mockArmorIQState.validProof ? "mock_proof_hash_abc123" : null,
    signature: mockArmorIQState.validSignature ? "mock_sig_xyz789" : null,
    token,
  };
});

export const mockSignIntent = vi.fn().mockImplementation(async (intent: Record<string, unknown>) => {
  if (mockArmorIQState.shouldTimeout) {
    throw new ArmorIQTimeoutError();
  }
  if (mockArmorIQState.shouldFailUnreachable) {
    throw new ArmorIQUnreachableError();
  }
  return {
    signed: true,
    intentId: "intent_mock_12345",
    signature: "mock_signature_hash_67890",
    intent,
  };
});

export const mockEvaluatePolicy = vi.fn().mockImplementation(async (context: Record<string, unknown>) => {
  if (mockArmorIQState.shouldTimeout) {
    throw new ArmorIQTimeoutError();
  }
  if (mockArmorIQState.shouldFailUnreachable) {
    throw new ArmorIQUnreachableError();
  }
  return {
    decision: mockArmorIQState.decision,
    ruleMatched: mockArmorIQState.ruleMatched,
    justification: mockArmorIQState.justification,
    context,
  };
});

export const mockValidateProof = vi.fn().mockImplementation((proofHash: string, signature: string) => {
  if (!proofHash || !signature) return false;
  return mockArmorIQState.validProof && mockArmorIQState.validSignature;
});

export const mockRecordAuditLog = vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
  if (mockArmorIQState.shouldTimeout) {
    throw new ArmorIQTimeoutError();
  }
  if (mockArmorIQState.shouldFailUnreachable) {
    throw new ArmorIQUnreachableError();
  }
  return {
    id: `armoriq_log_${Date.now()}`,
    status: "RECORDED",
    timestamp: new Date().toISOString(),
    ...payload,
  };
});

export class ArmorIQClient {
  public apiKey: string;

  constructor(options: { apiKey?: string } = {}) {
    this.apiKey = options.apiKey || SAFE_MOCK_ARMORIQ_API_KEY;
  }

  public verifyIntentToken = mockVerifyIntentToken;
  public signIntent = mockSignIntent;
  public evaluatePolicy = mockEvaluatePolicy;
  public validateProof = mockValidateProof;
  public recordAuditLog = mockRecordAuditLog;
}

export default ArmorIQClient;
