import { createHash } from "crypto";
import { redis } from "@/lib/redis";

const DEFAULT_AUDIO_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MEMORY_CACHE_MAX_ENTRIES = 200;

// In-memory fallback cache when Redis is unavailable
const memoryAudioCache = new Map<string, { buffer: Buffer; expiresAt: number }>();

export interface AuditoryBriefInput {
  findingType: string;
  severity: string;
  fileLocation: string;
  explanation?: string | null;
  remediation?: string | null;
}

/**
 * Summarizes the vulnerability explanation and remediation into a concise,
 * natural-sounding 1-2 sentence spoken auditory brief.
 */
export function generateAuditoryBrief(input: AuditoryBriefInput): string {
  const { findingType, severity, fileLocation, explanation, remediation } = input;

  // Clean explanation text
  let cleanExp = (explanation || "").replace(/\s+/g, " ").trim();
  cleanExp = cleanExp.replace(/[*#`_\[\]()]/g, "").trim();

  // Extract first informative sentence from explanation
  let summaryPart = "";
  if (cleanExp) {
    const sentences = cleanExp.split(/(?<=[.?!])\s+/);
    summaryPart = sentences[0] || "";
    // If the first sentence is very short, optionally take the second
    if (summaryPart.length < 30 && sentences.length > 1) {
      summaryPart = `${summaryPart} ${sentences[1]}`;
    }
  }

  if (!summaryPart) {
    summaryPart = `${severity} severity ${findingType} vulnerability identified in ${fileLocation}.`;
  }

  // Clean remediation text
  let cleanRem = (remediation || "").replace(/\s+/g, " ").trim();
  cleanRem = cleanRem.replace(/[*#`_\[\]()]/g, "").trim();

  let fixPart = "";
  if (cleanRem) {
    const remSentences = cleanRem.split(/(?<=[.?!])\s+/);
    fixPart = remSentences[0] || "";
  }

  if (!fixPart) {
    fixPart = `Apply standard input validation and least-privilege access controls to remediate.`;
  }

  // Formulate concise 1-2 sentence auditory debrief
  return `Security debrief for ${severity.toLowerCase()} severity ${findingType} in ${fileLocation}. ${summaryPart} Recommended fix: ${fixPart}`;
}

/**
 * Generates a cache key for the audio debrief based on finding ID and speech text hash.
 */
export function getAudioDebriefCacheKey(findingId: string, text: string): string {
  const textHash = createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
  return `audio-debrief:v1:${findingId}:${textHash}`;
}

/**
 * Retrieves cached audio MPEG buffer from Redis or in-memory fallback.
 */
export async function getCachedAudioDebrief(key: string): Promise<Buffer | null> {
  // Check in-memory cache first
  const mem = memoryAudioCache.get(key);
  if (mem) {
    if (Date.now() < mem.expiresAt) {
      return mem.buffer;
    }
    memoryAudioCache.delete(key);
  }

  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    if (!raw) return null;

    const buffer = Buffer.from(raw, "base64");
    // Populate in-memory fallback for faster subsequent reads
    memoryAudioCache.set(key, {
      buffer,
      expiresAt: Date.now() + 1000 * 60 * 60, // 1 hr in-memory
    });
    return buffer;
  } catch (err) {
    console.warn("[AUDIO_CACHE] Failed to read cached audio debrief:", err);
    return null;
  }
}

/**
 * Stores audio MPEG buffer in Redis and in-memory cache with TTL.
 */
export async function setCachedAudioDebrief(
  key: string,
  buffer: Buffer,
  ttlSeconds: number = DEFAULT_AUDIO_CACHE_TTL_SECONDS,
): Promise<void> {
  // Maintain bounded memory cache
  if (memoryAudioCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const firstKey = memoryAudioCache.keys().next().value;
    if (firstKey) memoryAudioCache.delete(firstKey);
  }

  memoryAudioCache.set(key, {
    buffer,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  if (!redis) return;

  try {
    const base64 = buffer.toString("base64");
    await redis.set(key, base64, "EX", ttlSeconds);
  } catch (err) {
    console.warn("[AUDIO_CACHE] Failed to write audio debrief to Redis:", err);
  }
}

/**
 * Generates a valid MPEG-1 Layer 3 audio buffer containing silent frames.
 * Ensures the response stream is playable in browser `<audio>` players even when
 * ElevenLabs credentials are unset or the external API is unreachable.
 */
export function createFallbackAudioBuffer(_text?: string): Buffer {
  const FRAME_COUNT = 12; // ~312ms playable audio buffer
  const FRAME_SIZE = 418;
  const buffer = Buffer.alloc(FRAME_SIZE * FRAME_COUNT);

  for (let i = 0; i < FRAME_COUNT; i++) {
    const offset = i * FRAME_SIZE;
    // MPEG-1 Layer 3 syncword & frame header: 128kbps, 44.1kHz, padded
    buffer[offset] = 0xff;
    buffer[offset + 1] = 0xfb;
    buffer[offset + 2] = 0x92;
    buffer[offset + 3] = 0x64;
  }

  return buffer;
}

export interface StreamElevenLabsOptions {
  voiceId?: string;
  modelId?: string;
  optimizeLatency?: number;
}

/**
 * Calls ElevenLabs text-to-speech stream endpoint with low-latency chunked streaming.
 */
export async function fetchElevenLabsAudioStream(
  text: string,
  options?: StreamElevenLabsOptions,
): Promise<Response | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const voiceId = options?.voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const modelId = options?.modelId || "eleven_turbo_v2_5";
  const latency = options?.optimizeLatency ?? 3;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=${latency}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      console.warn(`[ELEVENLABS] API error: ${response.status} ${response.statusText}`);
      return null;
    }

    return response;
  } catch (err) {
    console.warn("[ELEVENLABS] Network error calling ElevenLabs API:", err);
    return null;
  }
}
