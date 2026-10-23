import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  fetchElevenLabsMock,
  createFallbackAudioMock,
  getCachedAudioMock,
  setCachedAudioMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  fetchElevenLabsMock: vi.fn(),
  createFallbackAudioMock: vi.fn(),
  getCachedAudioMock: vi.fn(),
  setCachedAudioMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/findings/audio-debrief", () => ({
  fetchElevenLabsAudioStream: fetchElevenLabsMock,
  createFallbackAudioBuffer: createFallbackAudioMock,
  getCachedAudioDebrief: getCachedAudioMock,
  setCachedAudioDebrief: setCachedAudioMock,
}));

import { GET } from "./route";

describe("GET /api/voice-alerts/audio", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-test-123" } });
    createFallbackAudioMock.mockReturnValue(Buffer.from("fallback-silent-audio-bytes"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Authentication", () => {
    it("returns 401 when user session is null", async () => {
      authMock.mockResolvedValueOnce(null);

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=test/repo&decision=BLOCK&severity=CRITICAL",
      );
      const res = await GET(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });

    it("returns 401 when session exists but has no user ID", async () => {
      authMock.mockResolvedValueOnce({ user: {} });

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=test/repo&decision=BLOCK&severity=CRITICAL",
      );
      const res = await GET(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Query parameter validation", () => {
    it("returns 400 when missing repo parameter", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?decision=BLOCK&severity=CRITICAL",
      );
      const res = await GET(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        error: "Missing required query parameters: repo, decision, severity",
      });
    });

    it("returns 400 when missing decision parameter", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=owner/repo&severity=CRITICAL",
      );
      const res = await GET(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        error: "Missing required query parameters: repo, decision, severity",
      });
    });

    it("returns 400 when missing severity parameter", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=owner/repo&decision=BLOCK",
      );
      const res = await GET(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        error: "Missing required query parameters: repo, decision, severity",
      });
    });

    it("returns 400 when query parameters are empty whitespace", async () => {
      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=%20&decision=%20&severity=%20",
      );
      const res = await GET(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        error: "Missing required query parameters: repo, decision, severity",
      });
    });
  });

  describe("Cache HIT handling", () => {
    it("serves cached audio buffer with X-Cache: HIT and proper cache headers", async () => {
      const cachedBuffer = Buffer.from("cached-mp3-audio-bytes");
      getCachedAudioMock.mockResolvedValueOnce(cachedBuffer);

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/security-repo&decision=BLOCK&severity=CRITICAL",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
      expect(res.headers.get("X-Cache")).toBe("HIT");

      const bodyArrayBuffer = await res.arrayBuffer();
      expect(Buffer.from(bodyArrayBuffer)).toEqual(cachedBuffer);
      expect(fetchElevenLabsMock).not.toHaveBeenCalled();
      expect(setCachedAudioMock).not.toHaveBeenCalled();
    });
  });

  describe("Cache MISS with ElevenLabs synthesis", () => {
    it("synthesizes audio for BLOCK decision, caches buffer for 30 days, and returns X-Cache: MISS", async () => {
      getCachedAudioMock.mockResolvedValueOnce(null);

      const generatedAudio = Buffer.from("elevenlabs-generated-mp3-bytes");
      fetchElevenLabsMock.mockResolvedValueOnce(
        new Response(new Uint8Array(generatedAudio), {
          headers: { "content-type": "audio/mpeg" },
        }),
      );

      process.env.ELEVENLABS_VOICE_ID_ALERT = "alert-custom-voice-id";

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=acme/backend&decision=BLOCK&severity=CRITICAL",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
      expect(res.headers.get("X-Cache")).toBe("MISS");

      const bodyArrayBuffer = await res.arrayBuffer();
      expect(Buffer.from(bodyArrayBuffer)).toEqual(generatedAudio);

      const expectedAlertText =
        "Security alert: critical policy violation detected in repository acme/backend. Deployment has been halted.";
      expect(fetchElevenLabsMock).toHaveBeenCalledWith(expectedAlertText, {
        voiceId: "alert-custom-voice-id",
      });

      // 30-day TTL = 60 * 60 * 24 * 30 = 2592000 seconds
      expect(setCachedAudioMock).toHaveBeenCalledWith(
        expect.stringMatching(/^voice-alert-audio:v1:[a-f0-9]{16}$/),
        expect.any(Buffer),
        2592000,
      );
    });

    it("uses default voice when ELEVENLABS_VOICE_ID_ALERT is unset and formulates REVIEW action message", async () => {
      delete process.env.ELEVENLABS_VOICE_ID_ALERT;
      process.env.ELEVENLABS_VOICE_ID = "default-voice-id";

      getCachedAudioMock.mockResolvedValueOnce(null);

      const generatedAudio = Buffer.from("review-alert-audio-bytes");
      fetchElevenLabsMock.mockResolvedValueOnce(
        new Response(new Uint8Array(generatedAudio), {
          headers: { "content-type": "audio/mpeg" },
        }),
      );

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=acme/frontend&decision=REVIEW&severity=HIGH",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Cache")).toBe("MISS");

      const expectedAlertText =
        "Security alert: high policy violation detected in repository acme/frontend. Manual review is required before merging.";
      expect(fetchElevenLabsMock).toHaveBeenCalledWith(expectedAlertText, {
        voiceId: "default-voice-id",
      });
    });
  });

  describe("Fallback handling (missing API key, rate limits, quota exhaustion)", () => {
    it("returns silent fallback audio with X-Cache: FALLBACK when ElevenLabs returns null", async () => {
      getCachedAudioMock.mockResolvedValueOnce(null);
      fetchElevenLabsMock.mockResolvedValueOnce(null); // missing API key or 429 rate limit or 401 quota

      const fallbackBytes = Buffer.from("fallback-silent-audio-bytes");
      createFallbackAudioMock.mockReturnValueOnce(fallbackBytes);

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/repo&decision=BLOCK&severity=HIGH",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("X-Cache")).toBe("FALLBACK");

      const bodyArrayBuffer = await res.arrayBuffer();
      expect(Buffer.from(bodyArrayBuffer)).toEqual(fallbackBytes);

      expect(createFallbackAudioMock).toHaveBeenCalledWith(
        expect.stringContaining("Security alert: high policy violation detected"),
      );
      // Fallback audio must not be cached permanently in Redis
      expect(setCachedAudioMock).not.toHaveBeenCalled();
    });

    it("returns fallback audio when ElevenLabs response has no body stream", async () => {
      getCachedAudioMock.mockResolvedValueOnce(null);
      fetchElevenLabsMock.mockResolvedValueOnce({ body: null });

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/repo&decision=BLOCK&severity=MEDIUM",
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Cache")).toBe("FALLBACK");
      expect(createFallbackAudioMock).toHaveBeenCalled();
    });

    it("does not serve an empty buffer from the cache", async () => {
      getCachedAudioMock.mockResolvedValueOnce(Buffer.alloc(0));
      fetchElevenLabsMock.mockResolvedValueOnce(null);

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/repo&decision=BLOCK&severity=HIGH",
      );
      const res = await GET(req);

      expect(res.headers.get("X-Cache")).toBe("FALLBACK");
      expect(createFallbackAudioMock).toHaveBeenCalled();
      expect(fetchElevenLabsMock).toHaveBeenCalled();
    });

    it("rejects a non-audio upstream response without buffering or caching it", async () => {
      getCachedAudioMock.mockResolvedValueOnce(null);
      const arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("<html>upstream error</html>").buffer);
      fetchElevenLabsMock.mockResolvedValueOnce({
        body: true,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        arrayBuffer,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/repo&decision=BLOCK&severity=HIGH",
      );
      const res = await GET(req);

      expect(res.headers.get("X-Cache")).toBe("FALLBACK");
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(setCachedAudioMock).not.toHaveBeenCalled();
    });

    it("rejects an empty audio response instead of caching it for 30 days", async () => {
      getCachedAudioMock.mockResolvedValueOnce(null);
      fetchElevenLabsMock.mockResolvedValueOnce(
        new Response(new Uint8Array(0), {
          headers: { "content-type": "audio/mpeg" },
        }),
      );

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/repo&decision=BLOCK&severity=HIGH",
      );
      const res = await GET(req);

      expect(res.headers.get("X-Cache")).toBe("FALLBACK");
      expect(setCachedAudioMock).not.toHaveBeenCalled();
    });

    it("rejects an oversized declared response before reading its body", async () => {
      getCachedAudioMock.mockResolvedValueOnce(null);
      const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(1));
      fetchElevenLabsMock.mockResolvedValueOnce({
        body: true,
        headers: new Headers({
          "content-type": "audio/mpeg",
          "content-length": String(2 * 1024 * 1024 + 1),
        }),
        arrayBuffer,
      });

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/repo&decision=BLOCK&severity=HIGH",
      );
      const res = await GET(req);

      expect(res.headers.get("X-Cache")).toBe("FALLBACK");
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(setCachedAudioMock).not.toHaveBeenCalled();
    });

    it("rejects an oversized response when no content-length is provided", async () => {
      getCachedAudioMock.mockResolvedValueOnce(null);
      const oversizedBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
          controller.close();
        },
      });
      fetchElevenLabsMock.mockResolvedValueOnce(
        new Response(oversizedBody, {
          headers: { "content-type": "audio/mpeg" },
        }),
      );

      const req = new NextRequest(
        "http://localhost:3000/api/voice-alerts/audio?repo=org/repo&decision=BLOCK&severity=HIGH",
      );
      const res = await GET(req);

      expect(res.headers.get("X-Cache")).toBe("FALLBACK");
      expect(setCachedAudioMock).not.toHaveBeenCalled();
    });
  });
});
