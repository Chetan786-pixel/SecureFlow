/**
 * GET /api/voice-alerts/audio?repo=owner%2Frepo&decision=BLOCK&severity=CRITICAL
 *
 * Server-side audio synthesis for voice alerts (#1307).
 *
 * Reuses the existing ElevenLabs streaming and caching infrastructure from
 * src/lib/findings/audio-debrief.ts. The ElevenLabs API key never leaves
 * the server. Uses ELEVENLABS_VOICE_ID_ALERT when configured, falling back
 * to the default voice. Returns a silent MP3 fallback if ElevenLabs is
 * unavailable so the application never crashes.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchElevenLabsAudioStream,
  createFallbackAudioBuffer,
  getCachedAudioDebrief,
  setCachedAudioDebrief,
} from "@/lib/findings/audio-debrief";
import { createHash } from "crypto";
export const dynamic = "force-dynamic";
/** Cache TTL for alert audio: 30 days (messages are static and reusable). */
const ALERT_AUDIO_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Build the spoken alert message from query parameters. */
function buildAlertText(repo: string, decision: string, severity: string): string {
  const action =
    decision === "BLOCK"
      ? "Deployment has been halted."
      : "Manual review is required before merging.";
  return `Security alert: ${severity.toLowerCase()} policy violation detected in repository ${repo}. ${action}`;
}
/** Cache key for alert audio — based on the alert text content only. */
function alertAudioCacheKey(text: string): string {
  const hash = createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
  return `voice-alert-audio:v1:${hash}`;
}
export async function GET(request: NextRequest) {
  // 1. Authenticate — audio must only be served to signed-in users.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // 2. Validate query parameters.
  const { searchParams } = request.nextUrl;
  const repo = searchParams.get("repo")?.trim();
  const decision = searchParams.get("decision")?.trim().toUpperCase();
  const severity = searchParams.get("severity")?.trim().toUpperCase();
  if (!repo || !decision || !severity) {
    return NextResponse.json(
      { error: "Missing required query parameters: repo, decision, severity" },
      { status: 400 },
    );
  }
  // 3. Build alert text and cache key.
  const alertText = buildAlertText(repo, decision, severity);
  const cacheKey = alertAudioCacheKey(alertText);
  // 4. Serve from cache if available (Redis → in-memory fallback).
  const cached = await getCachedAudioDebrief(cacheKey);
  if (cached) {
    return new Response(new Uint8Array(cached), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Cache": "HIT",
      },
    });
  }
  // 5. Generate audio via ElevenLabs using the alert-specific voice ID.
  const voiceId = process.env.ELEVENLABS_VOICE_ID_ALERT || process.env.ELEVENLABS_VOICE_ID;
  const elevenLabsResponse = await fetchElevenLabsAudioStream(alertText, { voiceId });
  if (elevenLabsResponse?.body) {
    // Stream the response and cache the complete buffer for future requests.
    const audioBuffer = Buffer.from(await elevenLabsResponse.arrayBuffer());
    await setCachedAudioDebrief(cacheKey, audioBuffer, ALERT_AUDIO_TTL_SECONDS);
    return new Response(new Uint8Array(audioBuffer), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Cache": "MISS",
      },
    });
  }
  // 6. Fallback: return silent MP3 frames so the browser does not error out.
  const fallback = createFallbackAudioBuffer(alertText);
  return new Response(new Uint8Array(fallback), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-Cache": "FALLBACK",
    },
  });
}
