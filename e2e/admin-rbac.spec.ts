import { test, expect, setMockSession } from "./fixtures";

const ADMIN_ROUTES = ["/admin/users", "/admin/queue", "/admin/logs"];

test.describe("Admin portal", () => {
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
