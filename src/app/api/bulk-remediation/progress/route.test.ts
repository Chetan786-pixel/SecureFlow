import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/bulk-remediation/progress", () => {
  it("returns a text/event-stream response with SSE headers", async () => {
    const req = new NextRequest("http://localhost:3000/api/bulk-remediation/progress?total=2");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("Connection")).toBe("keep-alive");
    expect(res.body).toBeDefined();

    // Read the stream to verify chunks
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(decoder.decode(value));
      }
    }

    const fullPayload = chunks.join("");
    expect(fullPayload).toContain("data: ");
    expect(fullPayload).toContain('"processed":1');
    expect(fullPayload).toContain('"total":2');
    expect(fullPayload).toContain('"progress":50');
    expect(fullPayload).toContain('"status":"processing"');
    expect(fullPayload).toContain('"processed":2');
    expect(fullPayload).toContain('"progress":100');
    expect(fullPayload).toContain('"status":"completed"');
  });

  it("defaults totalFindings to 100 when query parameter is not provided", async () => {
    const req = new NextRequest("http://localhost:3000/api/bulk-remediation/progress");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read the very first chunk to inspect default total
    const { done, value } = await reader.read();
    expect(done).toBe(false);
    const firstChunk = decoder.decode(value!);
    expect(firstChunk).toContain('"total":100');
    expect(firstChunk).toContain('"processed":1');
    expect(firstChunk).toContain('"progress":1');

    // Cancel reader to avoid running full 100 iterations
    await reader.cancel();
  });
});
