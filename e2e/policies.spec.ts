import { expect, test } from "./fixtures";

test.describe("Security Policies & Guardrails Dashboard (#1352)", () => {
  test("renders policies dashboard with header and programmatic rule set preview", async ({
    page,
  }) => {
    await page.goto("/dashboard/policies");

    // Verify main header and subtitle
    await expect(page.getByRole("heading", { name: "The Rules" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Toggle automated guardrails used to protect your main branch."),
    ).toBeVisible();

    // Verify Programmatic Rule Set card
    await expect(page.getByText("Programmatic Rule Set")).toBeVisible();
    await expect(page.getByText(/Your active rules below are compiled dynamically/i)).toBeVisible();

    // Verify compiled JSON rule preview block exists
    const codeBlock = page.locator("pre");
    await expect(codeBlock).toBeVisible();
  });

  test("renders policy template rule cards or empty state gracefully", async ({ page }) => {
    await page.goto("/dashboard/policies");
    await expect(page.getByRole("heading", { name: "The Rules" })).toBeVisible({
      timeout: 15_000,
    });

    // Check either policy cards or empty state is displayed
    const emptyState = page.getByText(/No rule templates available/i);
    const switches = page.getByRole("switch");

    const hasSwitches = (await switches.count()) > 0;
    if (hasSwitches) {
      await expect(switches.first()).toBeVisible();
      // Ensure rule cards have titles and lock icons
      await expect(page.locator(".glass-card").first()).toBeVisible();
    } else {
      await expect(emptyState).toBeVisible();
    }
  });

  test("toggles policy switch state with optimistic UI feedback", async ({ page }) => {
    await page.goto("/dashboard/policies");
    await expect(page.getByRole("heading", { name: "The Rules" })).toBeVisible({
      timeout: 15_000,
    });

    const switches = page.getByRole("switch");
    if ((await switches.count()) > 0) {
      const firstSwitch = switches.first();
      await expect(firstSwitch).toBeVisible();

      const initialChecked = await firstSwitch.getAttribute("aria-checked");
      const initialLabel = await firstSwitch.getAttribute("aria-label");

      // Click to toggle switch
      await firstSwitch.click();

      // Verify state toggle is reflected immediately (optimistic UI update)
      const expectedChecked = initialChecked === "true" ? "false" : "true";
      await expect(firstSwitch).toHaveAttribute("aria-checked", expectedChecked, {
        timeout: 5_000,
      });

      // Verify aria-label updates accordingly
      if (initialLabel) {
        const expectedPrefix = initialChecked === "true" ? "Enable" : "Disable";
        await expect(firstSwitch).toHaveAttribute(
          "aria-label",
          new RegExp(`^${expectedPrefix}`, "i"),
        );
      }
    }
  });
});
