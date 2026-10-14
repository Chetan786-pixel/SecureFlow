import { describe, it, expect } from "vitest";
import MockGroq, {
  SAFE_MOCK_GROQ_API_KEY,
  assertSafeMockCredentials,
  mockCreate,
  mockStream,
} from "./groq-sdk";
import NextAuth, { SAFE_MOCK_SESSION } from "./next-auth";
import githubProvider from "./next-auth/providers/github";
import { auth, SAFE_MOCK_AUTH_SESSION } from "./auth";

describe("Mock Data Credentials Security Audit (#1303)", () => {
  describe("groq-sdk mock audit", () => {
    it("provides safe synthetic mock API key without real secrets", () => {
      expect(SAFE_MOCK_GROQ_API_KEY).toContain("mock");
      expect(SAFE_MOCK_GROQ_API_KEY).not.toMatch(/^gsk_[a-zA-Z0-9]{30,}$/);
    });

    it("initializes MockGroq with safe mock token", () => {
      const client = new MockGroq({ apiKey: "gsk_test_safe_mock_key" });
      expect(client.apiKey).toBe(SAFE_MOCK_GROQ_API_KEY);
      expect(client.chat.completions.create).toBe(mockCreate);
      expect(MockGroq.mockStream).toBe(mockStream);
    });

    it("assertSafeMockCredentials permits safe test tokens and rejects suspicious keys", () => {
      expect(assertSafeMockCredentials("gsk_mock_key")).toBe(true);
      expect(assertSafeMockCredentials("gsk_test_key")).toBe(true);
      expect(assertSafeMockCredentials(undefined)).toBe(true);
      expect(() => assertSafeMockCredentials("gsk_liveproductionkeythatshouldnotbehere")).toThrow(
        /SECURITY AUDIT/,
      );
    });
  });

  describe("next-auth mock audit", () => {
    it("provides synthetic session fixture without real tokens or private secrets", () => {
      expect(SAFE_MOCK_SESSION.user.email).toContain("secureflow.internal.test");
      expect(SAFE_MOCK_SESSION).not.toHaveProperty("accessToken");
      expect(SAFE_MOCK_SESSION).not.toHaveProperty("secret");
    });

    it("creates next-auth instance mock with safe handlers", async () => {
      const instance = NextAuth();
      expect(instance).toBeDefined();
      expect(typeof instance.signIn).toBe("function");
      expect(typeof instance.signOut).toBe("function");
      const authResult = await instance.auth();
      expect(authResult).toBeNull();
    });

    it("mocks github provider with dummy non-functional secrets", () => {
      const provider = githubProvider();
      expect(provider.id).toBe("github");
      expect(provider.config.clientId).toBe("mock-github-client-id");
      expect(provider.config.clientSecret).toBe("mock-github-client-secret-do-not-use");
    });
  });

  describe("auth mock audit", () => {
    it("returns safe mock session when invoked directly", async () => {
      const session = await auth()();
      expect(session).toEqual(SAFE_MOCK_AUTH_SESSION);
    });

    it("passes through handler functions as middleware wrapper", async () => {
      const testHandler = (req: { url: string }) => `handled:${req.url}`;
      const wrapped = auth(testHandler);
      const res = await wrapped({ url: "/test" });
      expect(res).toBe("handled:/test");
    });
  });
});
