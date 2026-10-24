import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
});

function request(query = ""): NextRequest {
  return new NextRequest(`http://localhost:3000/api/findings/bulk-remediate/progress${query}`);
}

describe("GET /api/findings/bulk-remediate/progress", () => {
  it("rejects unauthenticated callers before opening a stream", async () => {
    authMock.mockResolvedValueOnce(null);

    const res = await GET(request("?total=2"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it.each(["?total=0", "?total=-5", "?total=abc", "?total=1.5", "?total=101", "?total="])(
    "rejects invalid total %s",
    async (query) => {
      const res = await GET(request(query));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid total");
      expect(body.message).toContain("between 1 and 100");
    },
  );

  it("returns a text/event-stream response with SSE headers", async () => {
    const res = await GET(request("?total=2"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("Connection")).toBe("keep-alive");
    expect(res.body).toBeDefined();

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

  it("defaults totalFindings to the page limit when the query parameter is absent", async () => {
    const res = await GET(request());

    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const { done, value } = await reader.read();
    expect(done).toBe(false);
    const firstChunk = decoder.decode(value!);
    expect(firstChunk).toContain('"total":100');
    expect(firstChunk).toContain('"processed":1');
    expect(firstChunk).toContain('"progress":1');

    await reader.cancel();
  });
});
