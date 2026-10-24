/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Mock-auth test seam (see src/lib/mock-auth.ts). The app honours a
 * `mock-session` cookie when NEXT_PUBLIC_MOCK_AUTH and ALLOW_MOCK_AUTH are
 * both "true" (set by playwright.config.ts and CI), so tests can act as any
 * role without a real GitHub OAuth round trip.
 */
export type MockRole = "admin" | "user" | "none" | "no-codename" | "recruit";

const DEFAULT_BASE_URL = "http://localhost:9002";

export async function setMockSession(page: Page, role: MockRole, baseURL?: string) {
  await page
    .context()
    .addCookies([{ name: "mock-session", value: role, url: baseURL ?? DEFAULT_BASE_URL }]);
}

/** Default fixture: every test starts signed in as an admin. */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await setMockSession(page, "admin", baseURL);
    await use(page);
  },
});

export { expect };
