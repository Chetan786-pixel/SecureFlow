import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  checkRateLimitMock,
  findingFindFirstMock,
  findingUpdateMock,
  aiExplanationMock,
  generateBriefMock,
  getCacheKeyMock,
  getCachedAudioMock,
  setCachedAudioMock,
  fetchElevenLabsMock,
  createFallbackAudioMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  findingFindFirstMock: vi.fn(),
  findingUpdateMock: vi.fn(),
  aiExplanationMock: vi.fn(),
  generateBriefMock: vi.fn(),
  getCacheKeyMock: vi.fn(),
  getCachedAudioMock: vi.fn(),
  setCachedAudioMock: vi.fn(),
  fetchElevenLabsMock: vi.fn(),
  createFallbackAudioMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/lib/redis", () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    finding: {
      findFirst: findingFindFirstMock,
      update: findingUpdateMock,
    },
  },
}));

vi.mock("@/ai/flows/developer-receives-ai-security-explanations", () => ({
  developerReceivesAISecurityExplanations: aiExplanationMock,
}));

vi.mock("@/lib/findings/audio-debrief", () => ({
  generateAuditoryBrief: generateBriefMock,
  getAudioDebriefCacheKey: getCacheKeyMock,
  getCachedAudioDebrief: getCachedAudioMock,
  setCachedAudioDebrief: setCachedAudioMock,
  fetchElevenLabsAudioStream: fetchElevenLabsMock,
  createFallbackAudioBuffer: createFallbackAudioMock,
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  TIERS: {
    AI_STREAM: { limit: 20, windowSeconds: 60, fallbackStrategy: "fail-closed" },
    AI_STREAM_USER: {
      limit: 10,
      windowSeconds: 60,
      fallbackStrategy: "fail-closed",
      timeoutMs: 1000,
    },
  },
  withRateLimit: <T>(handler: T): T => handler,
}));

import { GET, POST } from "./route";

describe("/api/findings/[id]/audio-debrief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimitMock.mockResolvedValue(true);
    generateBriefMock.mockReturnValue("Auditory brief text for finding");
    getCacheKeyMock.mockReturnValue("cache-key-123");
    findingUpdateMock.mockReturnValue({ catch: vi.fn() });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/findings/f-1/audio-debrief");
    const params = Promise.resolve({ id: "f-1" });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 429 when user exceeds rate limits", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    checkRateLimitMock.mockResolvedValueOnce(false);

    const req = new NextRequest("http://localhost:3000/api/findings/f-1/audio-debrief");
    const params = Promise.resolve({ id: "f-1" });
    const res = await GET(req, { params });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("Too Many Requests");
  });

  it("returns 404 when finding is not found or not owned by user", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    findingFindFirstMock.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/findings/f-missing/audio-debrief");
    const params = Promise.resolve({ id: "f-missing" });
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Finding not found" });
  });

  it("returns 200 with cached audio on cache HIT", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    findingFindFirstMock.mockResolvedValueOnce({
      id: "f-1",
      type: "SQL_INJECTION",
      severity: "CRITICAL",
      fileLocation: "src/db.ts:12",
      codeSnippet: "SELECT * FROM users",
      explanation: "Vulnerable query",
      remediation: "Use parameterized queries",
    });

    const cachedBuffer = Buffer.from("cached-mp3-audio-bytes");
    getCachedAudioMock.mockResolvedValueOnce(cachedBuffer);

    const req = new NextRequest("http://localhost:3000/api/findings/f-1/audio-debrief");
    const params = Promise.resolve({ id: "f-1" });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("X-Audio-Cache")).toBe("HIT");
    expect(fetchElevenLabsMock).not.toHaveBeenCalled();
  });

  it("streams synthesized audio on ElevenLabs cache MISS", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    findingFindFirstMock.mockResolvedValueOnce({
      id: "f-1",
      type: "XSS",
      severity: "HIGH",
      fileLocation: "src/ui.tsx:10",
      codeSnippet: "<div dangerouslySetInnerHTML={...} />",
      explanation: "Cross-site scripting risk",
      remediation: "Sanitize HTML input",
    });

    getCachedAudioMock.mockResolvedValueOnce(null);

    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });
    fetchElevenLabsMock.mockResolvedValueOnce({ body: fakeStream });

    const req = new NextRequest("http://localhost:3000/api/findings/f-1/audio-debrief");
    const params = Promise.resolve({ id: "f-1" });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("X-Audio-Cache")).toBe("MISS");
    expect(res.body).toBeDefined();
  });

  it("returns fallback audio buffer when ElevenLabs TTS stream fails or is unavailable", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    findingFindFirstMock.mockResolvedValueOnce({
      id: "f-1",
      type: "COMMAND_INJECTION",
      severity: "HIGH",
      fileLocation: "src/exec.ts:5",
      codeSnippet: "exec(userInput)",
      explanation: "Unsanitized command execution",
      remediation: "Use execFile with argument array",
    });

    getCachedAudioMock.mockResolvedValueOnce(null);
    fetchElevenLabsMock.mockResolvedValueOnce(null);

    const fallbackBuffer = Buffer.from("fallback-mp3-bytes");
    createFallbackAudioMock.mockReturnValueOnce(fallbackBuffer);

    const req = new NextRequest("http://localhost:3000/api/findings/f-1/audio-debrief");
    const params = Promise.resolve({ id: "f-1" });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("X-Audio-Cache")).toBe("FALLBACK");
    expect(createFallbackAudioMock).toHaveBeenCalledWith("Auditory brief text for finding");
    expect(setCachedAudioMock).toHaveBeenCalledWith("cache-key-123", fallbackBuffer);
  });

  it("generates AI explanation dynamically when finding has no pre-existing explanation", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    findingFindFirstMock.mockResolvedValueOnce({
      id: "f-2",
      type: "HARDCODED_SECRET",
      severity: "MEDIUM",
      fileLocation: "src/config.ts:8",
      codeSnippet: "const apiKey = '12345'",
      explanation: null,
      remediation: null,
    });

    aiExplanationMock.mockResolvedValueOnce({
      explanation: "Generated explanation",
      remediationSuggestions: "Move to env",
      promptInjectionSuspected: false,
    });

    getCachedAudioMock.mockResolvedValueOnce(null);
    fetchElevenLabsMock.mockResolvedValueOnce(null);
    createFallbackAudioMock.mockReturnValueOnce(Buffer.from("audio"));

    const req = new NextRequest("http://localhost:3000/api/findings/f-2/audio-debrief", {
      method: "POST",
    });
    const params = Promise.resolve({ id: "f-2" });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(aiExplanationMock).toHaveBeenCalledWith({
      findingType: "HARDCODED_SECRET",
      severity: "MEDIUM",
      description: "",
      fileLocation: "src/config.ts:8",
      codeSnippet: "const apiKey = '12345'",
    });
    expect(findingUpdateMock).toHaveBeenCalled();
  });
});
