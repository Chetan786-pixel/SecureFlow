/**
 * Mock Auth.js / NextAuth Module (Security Audit Cleaned - #1303)
 *
 * Ensures all session mocks return safe, sanitized dummy profiles and tokens
 * without any hardcoded production secrets, session keys, or private credentials.
 */
import { vi } from "vitest";

/** Safe synthetic session fixture for test suites. */
export const SAFE_MOCK_AUTH_SESSION = Object.freeze({
  user: {
    id: "mock-test-user-id",
    name: "Mock Security Engineer",
    email: "mock-user@secureflow.internal.test",
    image: null,
  },
  expires: "2099-01-01T00:00:00.000Z",
});

export const auth =
  (handler?: any) =>
  async (req?: any, ...args: any[]) => {
    if (typeof handler === "function") {
      return handler(req, ...args);
    }
    return SAFE_MOCK_AUTH_SESSION;
  };

export const signIn = vi.fn();
export const signOut = vi.fn();
export const handlers = {};
