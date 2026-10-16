import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authMock, findUniqueMock, subscribeVoiceAlertMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
  subscribeVoiceAlertMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: findUniqueMock,
    },
  },
}));

vi.mock("@/lib/voice-alert-events", () => ({
  subscribeVoiceAlert: subscribeVoiceAlertMock,
}));

import { GET } from "./route";

describe("GET /api/voice-alerts/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when user session is null", async () => {
      authMock.mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream");
      const res = await GET(req);

      expect(res.status).toBe(401);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 401 when session has no user ID", async () => {
      authMock.mockResolvedValueOnce({ user: {} });

      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream");
      const res = await GET(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Opt-in preference validation", () => {
    it("returns 204 No Content when user is not found in database", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-unknown" } });
      findUniqueMock.mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream");
      const res = await GET(req);

      expect(res.status).toBe(204);
      expect(subscribeVoiceAlertMock).not.toHaveBeenCalled();
    });

    it("returns 204 No Content when user has voiceAlertsEnabled set to false", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-disabled" } });
      findUniqueMock.mockResolvedValueOnce({ voiceAlertsEnabled: false });

      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream");
      const res = await GET(req);

      expect(res.status).toBe(204);
      expect(findUniqueMock).toHaveBeenCalledWith({
        where: { id: "user-disabled" },
        select: { voiceAlertsEnabled: true },
      });
      expect(subscribeVoiceAlertMock).not.toHaveBeenCalled();
    });
  });

  describe("SSE streaming and event delivery", () => {
    it("sets up text/event-stream headers and sends initial connected heartbeat", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-active" } });
      findUniqueMock.mockResolvedValueOnce({ voiceAlertsEnabled: true });
      subscribeVoiceAlertMock.mockReturnValue(vi.fn());

      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream");
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(res.headers.get("Connection")).toBe("keep-alive");
      expect(res.headers.get("X-Accel-Buffering")).toBe("no");

      const reader = res.body?.getReader();
      expect(reader).toBeDefined();

      const { value, done } = await reader!.read();
      expect(done).toBe(false);
      const decoded = new TextDecoder().decode(value);
      expect(decoded).toBe('data: {"type":"connected"}\n\n');
    });

    it("subscribes to user channel and forwards voice alert event chunks over SSE", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-active" } });
      findUniqueMock.mockResolvedValueOnce({ voiceAlertsEnabled: true });

      let capturedCallback: ((event: unknown) => void) | null = null;
      subscribeVoiceAlertMock.mockImplementationOnce((userId, cb) => {
        capturedCallback = cb;
        return vi.fn();
      });

      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream");
      const res = await GET(req);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Read initial connected frame
      const firstChunk = await reader.read();
      expect(decoder.decode(firstChunk.value)).toBe('data: {"type":"connected"}\n\n');

      // Trigger incoming Redis Pub/Sub voice alert event
      expect(capturedCallback).toBeTypeOf("function");
      capturedCallback!({
        repositoryFullName: "acme/web",
        prNumber: 101,
        decision: "BLOCK",
        topSeverity: "CRITICAL",
        alertId: "alert-uuid-1",
      });

      const secondChunk = await reader.read();
      const secondDecoded = decoder.decode(secondChunk.value);
      expect(secondDecoded).toBe(
        'data: {"type":"voice-alert","repositoryFullName":"acme/web","prNumber":101,"decision":"BLOCK","topSeverity":"CRITICAL","alertId":"alert-uuid-1"}\n\n',
      );
    });

    it("unsubscribes and cleans up resources when client disconnects (request signal abort)", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-active" } });
      findUniqueMock.mockResolvedValueOnce({ voiceAlertsEnabled: true });

      const unsubscribeMock = vi.fn();
      subscribeVoiceAlertMock.mockReturnValueOnce(unsubscribeMock);

      const abortController = new AbortController();
      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream", {
        signal: abortController.signal,
      });
      const res = await GET(req);

      const reader = res.body!.getReader();
      await reader.read(); // Consume connected frame

      // Simulate client navigation / tab close
      abortController.abort();

      expect(unsubscribeMock).toHaveBeenCalled();
    });

    it("handles send errors gracefully if subscriber fires after controller close", async () => {
      authMock.mockResolvedValueOnce({ user: { id: "user-active" } });
      findUniqueMock.mockResolvedValueOnce({ voiceAlertsEnabled: true });

      let capturedCallback: ((event: unknown) => void) | null = null;
      subscribeVoiceAlertMock.mockImplementationOnce((_userId, cb) => {
        capturedCallback = cb;
        return vi.fn();
      });

      const abortController = new AbortController();
      const req = new NextRequest("http://localhost:3000/api/voice-alerts/stream", {
        signal: abortController.signal,
      });
      const res = await GET(req);

      const reader = res.body!.getReader();
      await reader.read();

      // Close reader and abort
      await reader.cancel();
      abortController.abort();

      // Calling callback after stream closed should not throw
      expect(() => {
        capturedCallback!({
          repositoryFullName: "acme/web",
          prNumber: 102,
          decision: "REVIEW",
          topSeverity: "HIGH",
          alertId: "alert-uuid-2",
        });
      }).not.toThrow();
    });
  });
});
