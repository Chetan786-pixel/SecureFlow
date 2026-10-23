import { test, expect, setMockSession } from "./fixtures";

test.describe("Codename setup flow", () => {
  for (const role of ["no-codename", "recruit"] as const) {
    test(`${role} session cannot stay on the dashboard`, async ({ page, baseURL }) => {
      await setMockSession(page, role, baseURL);
      await page.goto("/dashboard");
      await expect(page).not.toHaveURL(/\/dashboard/);
    });
  }

  for (const role of ["admin", "user"] as const) {
    test(`${role} session with a codename skips setup and lands on the dashboard`, async ({
      page,
      baseURL,
    }) => {
      await setMockSession(page, role, baseURL);
      await page.goto("/setup/codename");
      await expect(page).toHaveURL(/\/dashboard/);
    });
  }

  test("signed-out visitor is sent to login from codename setup", async ({ page, baseURL }) => {
    await setMockSession(page, "none", baseURL);
    await page.goto("/setup/codename");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Leaderboard", () => {
  test("is public and renders without signing in", async ({ page, baseURL }) => {
    await setMockSession(page, "none", baseURL);
    const response = await page.goto("/leaderboard");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/leaderboard/);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("link", { name: /home/i })).toBeVisible();
  });
});
