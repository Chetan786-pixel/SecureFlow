import { expect, test } from "./fixtures";

test.describe("Admin Portal & Administrative Controls (#1352)", () => {
  test("non-admin authenticated user visiting /admin is redirected away", async ({ page }) => {
    // Standard test login does not have ADMIN role by default
    await page.goto("/admin");
    await page.waitForURL((url) => url.pathname === "/" || !url.pathname.startsWith("/admin"), {
      timeout: 15_000,
    });
    expect(page.url()).not.toMatch(/\/admin(?:\/.*)?$/);
  });
});
