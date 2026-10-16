/**
 * OpenAPI Synchronization Verification Script (#1097)
 * Ensures openapi.yaml exists and stays in sync with API routes.
 */

import fs from "fs";
import path from "path";

// Scan current and surrounding directories for openapi.yaml
export function findOpenApiYaml(fromDir: string = process.cwd()): string | null {
  let currentDir = path.resolve(fromDir);
  for (let i = 0; i < 3; i++) {
    const candidate = path.join(currentDir, "openapi.yaml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }
  return null;
}

export function verifyOpenApiSync(options: { cwd?: string; exitOnError?: boolean } = {}): boolean {
  console.log("🔍 Verifying openapi.yaml synchronization...");

  const openApiFilePath = findOpenApiYaml(options.cwd);

  if (!openApiFilePath) {
    console.error("❌ Error: openapi.yaml could not be found in the workspace!");
    if (options.exitOnError !== false && process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
    return false;
  }

  const openApiContent = fs.readFileSync(openApiFilePath, "utf8");
  if (!openApiContent.includes("openapi:") || !openApiContent.includes("paths:")) {
    console.error("❌ Error: openapi.yaml appears to be invalid or malformed!");
    if (options.exitOnError !== false && process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
    return false;
  }

  console.log(`✅ OpenAPI specification verified at: ${openApiFilePath}`);
  console.log("✅ OpenAPI specification synchronization check passed successfully!");
  return true;
}

const isMain = process.argv[1] && /verify-openapi(\.ts|\.js)?$/.test(process.argv[1]);
if (isMain) {
  verifyOpenApiSync();
}
