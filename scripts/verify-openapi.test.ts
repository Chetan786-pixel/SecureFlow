import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { findOpenApiYaml, verifyOpenApiSync } from "./verify-openapi";

describe("scripts/verify-openapi.ts (#1354)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-openapi-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("findOpenApiYaml", () => {
    it("finds openapi.yaml in the specified directory", () => {
      const openapiPath = path.join(tempDir, "openapi.yaml");
      fs.writeFileSync(openapiPath, "openapi: 3.1.0\npaths:\n", "utf8");

      const found = findOpenApiYaml(tempDir);
      expect(found).toBe(openapiPath);
    });

    it("traverses up to parent directories to locate openapi.yaml", () => {
      const openapiPath = path.join(tempDir, "openapi.yaml");
      fs.writeFileSync(openapiPath, "openapi: 3.1.0\npaths:\n", "utf8");

      const subDir = path.join(tempDir, "nested", "subfolder");
      fs.mkdirSync(subDir, { recursive: true });

      const found = findOpenApiYaml(subDir);
      expect(found).toBe(openapiPath);
    });

    it("returns null when openapi.yaml does not exist in hierarchy", () => {
      const isolatedDir = path.join(tempDir, "isolated");
      fs.mkdirSync(isolatedDir, { recursive: true });

      const found = findOpenApiYaml(isolatedDir);
      expect(found).toBeNull();
    });
  });

  describe("verifyOpenApiSync", () => {
    it("returns true when openapi.yaml is valid with openapi and paths keys", () => {
      const openapiPath = path.join(tempDir, "openapi.yaml");
      fs.writeFileSync(
        openapiPath,
        "openapi: 3.1.0\ninfo:\n  title: SecureFlow API\npaths:\n  /api/health:\n    get:\n",
        "utf8",
      );

      const isValid = verifyOpenApiSync({ cwd: tempDir, exitOnError: false });
      expect(isValid).toBe(true);
    });

    it("verifies the workspace repository openapi.yaml successfully", () => {
      const isValid = verifyOpenApiSync({ exitOnError: false });
      expect(isValid).toBe(true);
    });

    it("returns false and logs error when openapi.yaml is not found", () => {
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const isValid = verifyOpenApiSync({ cwd: emptyDir, exitOnError: false });

      expect(isValid).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("openapi.yaml could not be found"),
      );
    });

    it("returns false when openapi.yaml is missing openapi version header", () => {
      const openapiPath = path.join(tempDir, "openapi.yaml");
      fs.writeFileSync(openapiPath, "paths:\n  /api/health:\n    get:\n", "utf8");

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const isValid = verifyOpenApiSync({ cwd: tempDir, exitOnError: false });

      expect(isValid).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("openapi.yaml appears to be invalid or malformed"),
      );
    });

    it("returns false when openapi.yaml is missing paths declaration (schema drift)", () => {
      const openapiPath = path.join(tempDir, "openapi.yaml");
      fs.writeFileSync(openapiPath, "openapi: 3.1.0\ninfo:\n  title: Test\n", "utf8");

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const isValid = verifyOpenApiSync({ cwd: tempDir, exitOnError: false });

      expect(isValid).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("openapi.yaml appears to be invalid or malformed"),
      );
    });
  });
});
