import { expect, test } from "@playwright/test";

test.describe("Public Surfaces — Leaderboard & API Playground (#1352)", () => {
  test.describe("The Resistance Leaderboard (/leaderboard)", () => {
    test("renders public Leaderboard page with bounty rates, live indicator, and Resistance Roster", async ({
      page,
    }) => {
      await page.goto("/leaderboard");

      // Verify page titles and banner
      await expect(page.getByRole("heading", { name: /Most Wanted\s*Leaderboard/i })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("La Casa de Papel · Resistance Roster")).toBeVisible();

      // Verify bounty scoring rate
      await expect(page.getByText("€10K per security point")).toBeVisible();

      // Verify live status indicator (either SSE live or polling mode)
      const liveBadge = page.getByText(/Live Updates|Polling/i);
      await expect(liveBadge).toBeVisible();

      // Verify explainer paragraph
      await expect(page.getByText(/The Resistance is ranked by security score/i)).toBeVisible();
    });

    test("renders operative podium or empty state placeholder", async ({ page }) => {
      await page.goto("/leaderboard");
      await expect(page.getByRole("heading", { name: /Most Wanted\s*Leaderboard/i })).toBeVisible({
        timeout: 15_000,
      });

      // Either podium and The Crew are visible, or the empty state message is shown
      const emptyState = page.getByText(
        /No operatives yet\. Merge a clean pull request to claim your first bounty\./i,
      );
      const crewTableHeading = page.getByRole("heading", { name: "The Crew" });

      const hasEmpty = await emptyState.isVisible();
      if (hasEmpty) {
        await expect(emptyState).toBeVisible();
      } else {
        await expect(crewTableHeading).toBeVisible();
        await expect(page.getByText(/operatives/i).first()).toBeVisible();
        // Check table headers
        await expect(page.locator("th", { hasText: "#" }).first()).toBeVisible();
        await expect(page.locator("th", { hasText: "Operative" }).first()).toBeVisible();
      }
    });

    test("navigation allows returning home and triggering system engagement", async ({ page }) => {
      await page.goto("/leaderboard");

      // Verify Home navigation link
      const homeLink = page.getByRole("link", { name: /Home/i });
      await expect(homeLink).toBeVisible();

      // Verify Engage System CTA
      const engageButton = page.getByRole("button", { name: /Engage System/i });
      await expect(engageButton).toBeVisible();
    });
  });

  test.describe("Interactive API Playground (/docs/api-playground)", () => {
    test("renders API Playground header, live explorer indicator, and architecture cards", async ({
      page,
    }) => {
      await page.goto("/docs/api-playground");

      // Verify hero header and badge
      await expect(page.getByText("Live API explorer")).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole("heading", { name: /Call the API\s*from your browser\./i }),
      ).toBeVisible();

      // Verify information cards
      await expect(page.getByText("Authentication")).toBeVisible();
      await expect(page.getByText(/Bearer token or session cookie/i)).toBeVisible();

      await expect(page.getByText("Webhooks")).toBeVisible();
      await expect(page.getByText(/HMAC-SHA256 signature verification/i)).toBeVisible();

      await expect(page.getByText("Written reference")).toBeVisible();
      await expect(page.getByText(/Full documentation and integration guides/i)).toBeVisible();
    });

    test("fetches OpenAPI specification endpoint (/api/openapi)", async ({ page }) => {
      let openApiRequested = false;

      page.on("request", (req) => {
        if (req.url().includes("/api/openapi")) {
          openApiRequested = true;
        }
      });

      await page.goto("/docs/api-playground");
      await expect(page.getByText("Live API explorer")).toBeVisible({ timeout: 15_000 });

      // Verify direct access to the OpenAPI specification endpoint
      const response = await page.request.get("/api/openapi");
      expect([200, 304]).toContain(response.status());
    });
  });
});
