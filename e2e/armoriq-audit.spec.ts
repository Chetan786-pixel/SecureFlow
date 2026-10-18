import { expect, test } from "./fixtures";

test.describe("ArmorIQ Audit Dashboard & Policy Enforcement E2E (#1355)", () => {
  const mockArmorIQTraces = [
    {
      id: "trace-armoriq-001",
      scanJobId: "scan-job-101",
      findingId: "finding-201",
      agentId: "agent-security-auditor",
      toolName: "ast-security-scanner",
      decision: "ALLOW",
      ruleMatched: "DEFAULT_ZERO_TRUST_POLICY",
      justification: "Permitted static AST analysis within repository boundary",
      proofHash: "0xproof_hash_allow_abc123789",
      signature: "0xsig_allow_provenance_valid",
      intentId: "intent-allow-001",
      frameworks: ["SOC 2 CC6.1", "ISO 27001 A.12.1.2"],
      privacyLevel: "Zero-Retention Metadata Mode",
      timestamp: "2026-10-18T10:00:00.000Z",
    },
    {
      id: "trace-armoriq-002",
      scanJobId: "scan-job-102",
      findingId: "finding-202",
      agentId: "agent-unauthorized-infiltrator",
      toolName: "bash-network-exfil",
      decision: "BLOCK",
      ruleMatched: "deny:tampered_intent",
      justification:
        "Cryptographic intent verification failed: signature mismatch and plan deviation",
      proofHash: "0xproof_hash_block_invalid456",
      signature: "0xsig_block_tampered_invalid",
      intentId: "intent-block-002",
      frameworks: ["SOC 2 CC6.8", "ISO 27001 A.14.2.8"],
      privacyLevel: "Zero-Retention Metadata Mode",
      timestamp: "2026-10-18T10:05:00.000Z",
    },
  ];

  test("renders ArmorIQ audit traces table with status badges and cryptographic indicators", async ({
    page,
  }) => {
    await page.route("**/api/audit/armoriq*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          traces: mockArmorIQTraces,
          total: 2,
        }),
      });
    });

    await page.goto("/dashboard/audit");
    await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible({
      timeout: 15_000,
    });

    const armoriqToggle = page.getByRole("button", { name: /ArmorIQ Traces/i });
    await expect(armoriqToggle).toBeVisible();
    await armoriqToggle.click();

    await expect(page.getByRole("button", { name: /ArmorIQ Active/i })).toBeVisible();

    await expect(page.getByText("ARMORIQ_TOOL_ALLOW").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("ARMORIQ_TOOL_BLOCK").first()).toBeVisible();

    await expect(page.getByText("ast-security-scanner").first()).toBeVisible();
    await expect(page.getByText("bash-network-exfil").first()).toBeVisible();

    await expect(page.getByText("ALLOW").first()).toBeVisible();
    await expect(page.getByText("BLOCK").first()).toBeVisible();
  });

  test("filters ArmorIQ traces by policy decision", async ({ page }) => {
    await page.route("**/api/audit/armoriq*", async (route) => {
      const url = new URL(route.request().url());
      const decisionParam = url.searchParams.get("decision");

      if (decisionParam === "BLOCK") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            traces: mockArmorIQTraces.filter((t) => t.decision === "BLOCK"),
            total: 1,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            traces: mockArmorIQTraces,
            total: 2,
          }),
        });
      }
    });

    await page.goto("/dashboard/audit");
    await page.getByRole("button", { name: /ArmorIQ Traces/i }).click();

    await expect(page.getByText("ARMORIQ_TOOL_ALLOW").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("ARMORIQ_TOOL_BLOCK").first()).toBeVisible();

    const decisionSelect = page.getByRole("combobox").filter({ hasText: /All Decisions/i });
    if (await decisionSelect.isVisible()) {
      await decisionSelect.click();
      await page.getByRole("option", { name: "BLOCK" }).click();

      await expect(page.getByText("ARMORIQ_TOOL_BLOCK").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("ARMORIQ_TOOL_ALLOW")).toBeHidden();
    }
  });

  test("paginates through multiple pages of ArmorIQ audit traces", async ({ page }) => {
    await page.route("**/api/audit/armoriq*", async (route) => {
      const url = new URL(route.request().url());
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = parseInt(url.searchParams.get("limit") || "10", 10);

      const generatedTraces = Array.from({ length: 25 }, (_, i) => ({
        id: `trace-armoriq-paged-${i + 1}`,
        scanJobId: `scan-job-${100 + i}`,
        agentId: `agent-${i + 1}`,
        toolName: `tool-worker-${i + 1}`,
        decision: i % 2 === 0 ? "ALLOW" : "BLOCK",
        ruleMatched: "DEFAULT_ZERO_TRUST_POLICY",
        justification: `Automated test trace record ${i + 1}`,
        proofHash: `proof_hash_${i + 1}`,
        signature: `signature_${i + 1}`,
        intentId: `intent_${i + 1}`,
        frameworks: ["SOC 2 CC6.1"],
        privacyLevel: "Zero-Retention Metadata Mode",
        timestamp: new Date(Date.now() - i * 60000).toISOString(),
      }));

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          traces: generatedTraces.slice(offset, offset + limit),
          total: 25,
        }),
      });
    });

    await page.goto("/dashboard/audit");
    await page.getByRole("button", { name: /ArmorIQ Traces/i }).click();

    await expect(page.getByText(/Showing 1 to 10 of 25 logs/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("1 / 3")).toBeVisible();

    const nextButton = page.getByRole("button", { name: /Next/i });
    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(page.getByText(/Showing 11 to 20 of 25 logs/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("2 / 3")).toBeVisible();

    const prevButton = page.getByRole("button", { name: /Previous/i });
    await expect(prevButton).toBeEnabled();
    await prevButton.click();

    await expect(page.getByText(/Showing 1 to 10 of 25 logs/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("1 / 3")).toBeVisible();
  });

  test("expands ArmorIQ cryptographic intent & compliance details panel", async ({ page }) => {
    await page.route("**/api/audit/armoriq*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          traces: mockArmorIQTraces,
          total: 2,
        }),
      });
    });

    await page.goto("/dashboard/audit");
    await page.getByRole("button", { name: /ArmorIQ Traces/i }).click();

    const detailsSummary = page
      .locator("summary", {
        hasText: /ArmorIQ Cryptographic Intent & Compliance Evidence/i,
      })
      .first();
    await expect(detailsSummary).toBeVisible({ timeout: 10_000 });
    await detailsSummary.click();

    await expect(page.getByText("Agent Identity & Intent").first()).toBeVisible();
    await expect(page.getByText("Cryptographic Provenance").first()).toBeVisible();
    await expect(page.getByText(/SOC 2/i).first()).toBeVisible();
    await expect(page.getByText(/ISO 27001/i).first()).toBeVisible();
  });

  test("handles upstream 503 degraded service state gracefully", async ({ page }) => {
    await page.route("**/api/audit/armoriq*", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Upstream ArmorIQ audit service is temporarily unavailable",
        }),
      });
    });

    await page.goto("/dashboard/audit");
    const armoriqToggle = page.getByRole("button", { name: /ArmorIQ Traces/i });
    await expect(armoriqToggle).toBeVisible({ timeout: 15_000 });
    await armoriqToggle.click();

    await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();
  });
});
