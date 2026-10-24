import { test, expect } from "./fixtures";

test.describe("Policies management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/policies");
  });

  test("renders the rules page with the compiled rule set", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "The Rules" })).toBeVisible();
    await expect(page.getByText("Programmatic Rule Set")).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: '"deny"' })).toBeVisible();
  });

  test("shows the ArmorIQ inactive notice when no API key is configured", async ({ page }) => {
    await expect(page.getByText(/ArmorIQ cloud enforcement is inactive/i)).toBeVisible();
  });

  test("shows an empty state when no rule templates are seeded", async ({ page }) => {
    test.skip((await page.getByRole("switch").count()) > 0, "Rule templates are seeded");
    await expect(page.getByText(/No rule templates available/i)).toBeVisible();
  });

  test("toggling a rule flips its switch", async ({ page }) => {
    const switches = page.getByRole("switch");
    test.skip((await switches.count()) === 0, "No rule templates seeded in the mock database");

    const firstSwitch = switches.first();
    const before = await firstSwitch.getAttribute("aria-checked");
    await firstSwitch.click();
    await expect(firstSwitch).not.toHaveAttribute("aria-checked", before ?? "");
  });
});
