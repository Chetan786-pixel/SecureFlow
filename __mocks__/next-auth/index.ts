/**
 * Mock next-auth Module (Security Audit Cleaned - #1303)
 *
 * This mock ensures test suites run with synthetic authentication context
 * without requiring or storing hardcoded OAuth tokens, client secrets, or user credentials.
 */
import { vi } from "vitest";

/** Safe synthetic session fixture for test suites. */
export const SAFE_MOCK_SESSION = Object.freeze({
  user: {
    id: "mock_test_user_id",
    name: "Mock Security Engineer",
    email: "mock-user@secureflow.internal.test",
    image: null,
  },
  expires: "2099-01-01T00:00:00.000Z",
});

const NextAuth = vi.fn(() => ({
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
  auth: vi.fn(async () => null),
}));

export default NextAuth;
