/**
 * ArmorIQ Cryptographic Pre-Execution Intent Signing (#1275)
 *
 * Implements intent capture and cryptographic signing before any autonomous agent
 * can trigger tools, read files, or contact external APIs.
 * Generates tamper-evident HMAC-SHA256 signatures and SHA-256 intent hashes.
 */

import { createHmac, createHash, randomUUID } from "node:crypto";
import { agentRegistry, ARMORIQ_AGENT_IDS } from "./agent-registry";

export interface ExecutionPlan {
  goal: string;
  proposedTools: string[];
  targetPaths?: string[];
  metadata?: Record<string, unknown>;
}

export interface SignedIntent {
  intentId: string;
  agentId: string;
  timestamp: number;
  plan: ExecutionPlan;
  intentHash: string;
  signature: string;
  intentToken: string;
  complianceMetadata: {
    frameworks: string[];
    tamperEvident: boolean;
  };
}

/**
 * Resolve the HMAC key used for intent provenance.
 *
 * A built-in fallback key is public knowledge, so a deployment that forgot to
 * set the environment variable would accept signatures forged by anyone who has
 * read this repository. There is no safe default: signing fails loudly instead.
 */
function resolveSigningKey(explicitKey?: string): string {
  const key = explicitKey?.trim() || process.env.ARMORIQ_PROOF_SIGNING_KEY?.trim();
  if (!key) {
    throw new Error(
      "ARMORIQ_PROOF_SIGNING_KEY is not configured; refusing to sign or verify ArmorIQ intents with a public fallback key.",
    );
  }
  return key;
}

/**
 * Computes a deterministic SHA-256 hash for an execution plan.
 */
export function computeIntentHash(
  intentId: string,
  agentId: string,
  plan: ExecutionPlan,
  timestamp: number,
): string {
  const normalizedPayload = JSON.stringify({
    intentId,
    agentId,
    goal: plan.goal,
    proposedTools: [...plan.proposedTools].sort(),
    targetPaths: plan.targetPaths ? [...plan.targetPaths].sort() : [],
    metadata: plan.metadata ?? {},
    timestamp,
  });

  return createHash("sha256").update(normalizedPayload).digest("hex");
}

/**
 * Creates an HMAC-SHA256 signature for the intent hash.
 */
export function signIntentHash(intentHash: string, signingKey?: string): string {
  return createHmac("sha256", resolveSigningKey(signingKey)).update(intentHash).digest("hex");
}

/**
 * Emits an execution plan and cryptographically signs it under ArmorIQ policy.
 */
export function declareAndSignIntent(
  agentId: string,
  plan: ExecutionPlan,
  signingKey?: string,
): SignedIntent {
  const policy = agentRegistry.get(agentId);
  const intentId = `intent_${randomUUID()}`;
  const timestamp = Date.now();
  const resolvedKey = resolveSigningKey(signingKey);

  const intentHash = computeIntentHash(intentId, agentId, plan, timestamp);
  const signature = signIntentHash(intentHash, resolvedKey);

  // Mint a mock/standard JWT-style intent token for downstream gateway compatibility
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: agentId,
      iid: intentId,
      tools: plan.proposedTools,
      exp: Math.floor((timestamp + 3600000) / 1000), // 1 hour expiry
      iat: Math.floor(timestamp / 1000),
      intentHash,
    }),
  ).toString("base64url");
  const intentToken = `${header}.${payload}.${signature.slice(0, 43)}`;

  return {
    intentId,
    agentId,
    timestamp,
    plan,
    intentHash,
    signature,
    intentToken,
    complianceMetadata: {
      frameworks: policy?.complianceFrameworks ?? ["SOC 2 (CC6.1)", "NIST SP 800-53 (AC-3)"],
      tamperEvident: true,
    },
  };
}

/**
 * Cryptographically verifies a signed intent and confirms its integrity.
 */
export function verifySignedIntent(
  signedIntent: SignedIntent,
  signingKey?: string,
): { valid: boolean; reason?: string } {
  if (!signedIntent || typeof signedIntent !== "object") {
    return { valid: false, reason: "Missing or malformed signed intent structure." };
  }

  let resolvedKey: string;
  try {
    resolvedKey = resolveSigningKey(signingKey);
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "ArmorIQ signing key is not configured.",
    };
  }

  const expectedHash = computeIntentHash(
    signedIntent.intentId,
    signedIntent.agentId,
    signedIntent.plan,
    signedIntent.timestamp,
  );

  if (expectedHash !== signedIntent.intentHash) {
    return {
      valid: false,
      reason: "Tamper detection: Intent hash does not match execution plan payload.",
    };
  }

  const expectedSig = signIntentHash(expectedHash, resolvedKey);
  if (expectedSig !== signedIntent.signature) {
    return {
      valid: false,
      reason: "Cryptographic signature verification failed (invalid provenance).",
    };
  }

  return { valid: true };
}
