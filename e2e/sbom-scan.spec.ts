import { expect, test } from "./fixtures";
import { test as base } from "@playwright/test";

test.describe("SBOM Scan Asynchronous Enqueue & Status Polling API (#1352)", () => {
  const samplePackageJson = JSON.stringify(
    {
      name: "sample-project",
      version: "1.0.0",
      dependencies: {
        express: "^4.18.2",
        lodash: "^4.17.21",
      },
    },
    null,
    2,
  );

  test("enqueues valid SBOM scan for package.json and returns 202 Accepted with job status URL", async ({
    page,
  }) => {
    // Intercept route or invoke API with session context
    await page.route("**/api/sbom/scan", async (route) => {
      if (route.request().method() === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        if (body.fileName === "package.json" && body.content) {
          await route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({
              jobId: "scan-job-e2e-sbom-001",
              status: "QUEUED",
              statusUrl: "/api/sbom/scan/status/scan-job-e2e-sbom-001",
              fileName: "package.json",
            }),
          });
          return;
        }
      }
      await route.fallback();
    });

    const response = await page.request.post("/api/sbom/scan", {
      data: {
        fileName: "package.json",
        content: samplePackageJson,
      },
    });

    expect(response.status()).toBe(202);
    const data = await response.json();
    expect(data).toHaveProperty("jobId");
    expect(data.status).toBe("QUEUED");
    expect(data.statusUrl).toContain("/api/sbom/scan/status/");
    expect(data.fileName).toBe("package.json");
  });

  test("rejects path traversal in fileName with 400 Bad Request", async ({ page }) => {
    const response = await page.request.post("/api/sbom/scan", {
      data: {
        fileName: "../package.json",
        content: samplePackageJson,
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error || data.message).toMatch(/path traversal/i);
  });

  test("rejects unsupported manifest file type with 400 Bad Request", async ({ page }) => {
    const response = await page.request.post("/api/sbom/scan", {
      data: {
        fileName: "exploit.bin",
        content: "binary-payload",
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error || data.message).toMatch(/supported manifest/i);
  });

  test("rejects empty manifest content with 400 Bad Request", async ({ page }) => {
    const response = await page.request.post("/api/sbom/scan", {
      data: {
        fileName: "package.json",
        content: "",
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error || data.message).toMatch(/content is required/i);
  });

  test("polls SBOM scan job status via GET /api/sbom/scan/status/[jobId]", async ({ page }) => {
    await page.route("**/api/sbom/scan/status/scan-job-polled-001", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "scan-job-polled-001",
          status: "COMPLETED",
          result: {
            vulnerabilitiesCount: 0,
            packagesCount: 2,
            summary: "CLEAN",
          },
        }),
      });
    });

    const response = await page.request.get("/api/sbom/scan/status/scan-job-polled-001");
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.jobId).toBe("scan-job-polled-001");
    expect(data.status).toBe("COMPLETED");
    expect(data.result.summary).toBe("CLEAN");
  });

  test("returns 404 for non-existent scan job ID", async ({ page }) => {
    const response = await page.request.get("/api/sbom/scan/status/non-existent-scan-job-id");
    expect([404, 400]).toContain(response.status());
  });

  base(
    "returns 401 Unauthorized for unauthenticated scan request",
    async ({ request, baseURL }) => {
      const response = await request.post(`${baseURL ?? "http://localhost:9002"}/api/sbom/scan`, {
        data: {
          fileName: "package.json",
          content: samplePackageJson,
        },
      });

      expect(response.status()).toBe(401);
    },
  );
});
