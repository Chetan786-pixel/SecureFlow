import { afterEach, describe, expect, it } from "vitest";
import { ArmorIQBoundaryInterceptor } from "./boundary-interceptor";
import { ARMORIQ_AGENT_IDS } from "./agent-registry";
import {
  declareAndSignIntent,
  signIntentHash,
  verifySignedIntent,
  type ExecutionPlan,
} from "./intent-signing";

const ORIGINAL_SIGNING_KEY = process.env.ARMORIQ_PROOF_SIGNING_KEY;

const PLAN: ExecutionPlan = {
  goal: "Generate a patch for a SQL injection finding",
  proposedTools: ["generateUnifiedDiff"],
  targetPaths: ["src/api/handler.ts"],
};

afterEach(() => {
  if (ORIGINAL_SIGNING_KEY === undefined) {
    delete process.env.ARMORIQ_PROOF_SIGNING_KEY;
  } else {
    process.env.ARMORIQ_PROOF_SIGNING_KEY = ORIGINAL_SIGNING_KEY;
  }
});

describe("ArmorIQ proof signing keys", () => {
  it("refuses to sign intents when no key is configured", () => {
    delete process.env.ARMORIQ_PROOF_SIGNING_KEY;

    expect(() => signIntentHash("intent-hash")).toThrow(/ARMORIQ_PROOF_SIGNING_KEY/);
    expect(() => declareAndSignIntent(ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR, PLAN)).toThrow(
      /ARMORIQ_PROOF_SIGNING_KEY/,
    );
  });

  it("treats an intent as unverifiable when the key is missing", () => {
    const signed = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      PLAN,
      "test-intent-key",
    );
    expect(verifySignedIntent(signed, "test-intent-key").valid).toBe(true);

    delete process.env.ARMORIQ_PROOF_SIGNING_KEY;
    const result = verifySignedIntent(signed);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ARMORIQ_PROOF_SIGNING_KEY/);
  });

  it("refuses to construct a boundary interceptor without a key", () => {
    delete process.env.ARMORIQ_PROOF_SIGNING_KEY;

    expect(() => new ArmorIQBoundaryInterceptor()).toThrow(/ARMORIQ_PROOF_SIGNING_KEY/);
  });

  it("rejects a boundary proof when verification has no key", () => {
    const interceptor = new ArmorIQBoundaryInterceptor("test-boundary-key");
    const proof = interceptor.intercept({ type: "fs.read", path: "src/api/handler.ts" }).prove();

    expect(ArmorIQBoundaryInterceptor.verifyProof(proof, "test-boundary-key")).toBe(true);

    delete process.env.ARMORIQ_PROOF_SIGNING_KEY;
    expect(ArmorIQBoundaryInterceptor.verifyProof(proof)).toBe(false);
  });

  it("still signs and verifies with an explicitly supplied key", () => {
    delete process.env.ARMORIQ_PROOF_SIGNING_KEY;

    const signed = declareAndSignIntent(
      ARMORIQ_AGENT_IDS.REMEDIATION_PATCH_GENERATOR,
      PLAN,
      "explicit-intent-key",
    );
    const interceptor = new ArmorIQBoundaryInterceptor("explicit-boundary-key");
    const proof = interceptor.intercept({ type: "fs.read", path: "src/api/handler.ts" }).prove();

    expect(verifySignedIntent(signed, "explicit-intent-key").valid).toBe(true);
    expect(ArmorIQBoundaryInterceptor.verifyProof(proof, "explicit-boundary-key")).toBe(true);
  });
});
