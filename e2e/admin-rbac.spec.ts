import { test, expect, setMockSession } from "./fixtures";

const ADMIN_ROUTES = ["/admin/users", "/admin/queue", "/admin/logs"];

test.describe("Admin portal", () => {
  for (const route of ADMIN_ROUTES) {
    test(`admin can open ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(route));
      await expect(page.locator("main")).toBeVisible();
    });
  }

  for (const role of ["user", "none"] as const) {
    test(`${role} session cannot stay on admin pages`, async ({ page, baseURL }) => {
      await setMockSession(page, role, baseURL);
      for (const route of ADMIN_ROUTES) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/\/admin\//);
      }
    });
  }
});
