import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { developerReceivesAISecurityExplanations } from "@/ai/flows/developer-receives-ai-security-explanations";
import {
  generateAuditoryBrief,
  getAudioDebriefCacheKey,
  getCachedAudioDebrief,
  setCachedAudioDebrief,
  fetchElevenLabsAudioStream,
  createFallbackAudioBuffer,
} from "@/lib/findings/audio-debrief";
import { withRateLimit, TIERS } from "@/lib/middleware/rate-limit";
import { checkRateLimit } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * Streams low-latency synthesized audio debrief for a finding's AI security explanation.
 *
 * Requirements:
 * 1. Authenticate session and verify finding ownership.
 * 2. Retrieve finding + AI security explanation (generated via developerReceivesAISecurityExplanations).
 * 3. Summarize explanation into concise auditory brief (summary + risk + recommended fix).
 * 4. Serve cached audio instantly (<50ms) or stream from ElevenLabs (optimize_streaming_latency=3).
 */
async function handler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // User-based rate-limiting bucket
  const userAllowed = await checkRateLimit(
    `rate-limit:audio-debrief:user:${userId}`,
    TIERS.AI_STREAM_USER.limit,
    TIERS.AI_STREAM_USER.windowSeconds,
    {
      fallbackStrategy: TIERS.AI_STREAM_USER.fallbackStrategy,
      timeoutMs: TIERS.AI_STREAM_USER.timeoutMs,
    },
  );
  if (!userAllowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: "You have exceeded the rate limit for audio debriefs. Please try again later.",
      },
      { status: 429, headers: { "Retry-After": String(TIERS.AI_STREAM_USER.windowSeconds) } },
    );
  }

  const { id } = await params;

  // Scope lookup to finding owned by the session user
  const finding = await prisma.finding.findFirst({
    where: {
      id,
      scanResult: {
        pullRequest: {
          repository: { userId },
        },
      },
    },
    select: {
      id: true,
      type: true,
      severity: true,
      fileLocation: true,
      codeSnippet: true,
      explanation: true,
      remediation: true,
    },
  });

  if (!finding) {
    return NextResponse.json({ error: "Finding not found" }, { status: 404 });
  }

  // Retrieve or generate AI security explanation
  let explanation = finding.explanation;
  let remediation = finding.remediation;

  if (!explanation) {
    try {
      const aiOutput = await developerReceivesAISecurityExplanations({
        findingType: finding.type,
        severity: finding.severity,
        description: "",
        fileLocation: finding.fileLocation,
        codeSnippet: finding.codeSnippet || "",
      });
      explanation = aiOutput.explanation;
      remediation = aiOutput.remediationSuggestions;

      // Asynchronously persist explanation so subsequent full page loads benefit
      prisma.finding
        .update({
          where: { id: finding.id },
          data: {
            explanation: aiOutput.explanation,
            remediation: aiOutput.remediationSuggestions,
            promptInjectionSuspected: aiOutput.promptInjectionSuspected,
          },
        })
        .catch(() => {});
    } catch (err) {
      console.warn("[AUDIO_DEBRIEF] Failed to generate AI security explanation:", err);
    }
  }

  // Summarize into concise auditory brief
  const briefText = generateAuditoryBrief({
    findingType: finding.type,
    severity: finding.severity,
    fileLocation: finding.fileLocation,
    explanation,
    remediation,
  });

  const cacheKey = getAudioDebriefCacheKey(finding.id, briefText, remediation);

  // Cached audio serves instantly without triggering downstream ElevenLabs generation
  const cachedAudio = await getCachedAudioDebrief(cacheKey);
  if (cachedAudio) {
    return new Response(cachedAudio as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(cachedAudio.length),
        "X-Audio-Cache": "HIT",
        "Cache-Control": "public, max-age=86400, immutable",
        ETag: `"${cacheKey}"`,
      },
    });
  }

  // If client explicitly requests JSON and ELEVENLABS_API_KEY is not configured
  if (
    request.headers.get("accept")?.includes("application/json") &&
    !process.env.ELEVENLABS_API_KEY
  ) {
    return NextResponse.json(
      {
        error: "Configuration Error",
        message: "ElevenLabs API key is not configured.",
      },
      { status: 503 },
    );
  }

  // Stream synthesized audio using ElevenLabs low-latency chunked streaming
  let elevenLabsStream: Response | null = null;
  try {
    elevenLabsStream = await fetchElevenLabsAudioStream(briefText, {
      optimizeLatency: 3,
    });
  } catch (err) {
    console.warn("[AUDIO_DEBRIEF] Failed to stream from ElevenLabs:", err);
  }

  if (elevenLabsStream && elevenLabsStream.body) {
    const [streamForClient, streamForCache] = elevenLabsStream.body.tee();

    // Cache downstream chunks in background
    (async () => {
      try {
        const reader = streamForCache.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        const fullBuffer = Buffer.concat(chunks);
        if (fullBuffer.length > 0) {
          await setCachedAudioDebrief(cacheKey, fullBuffer);
        }
      } catch (err) {
        console.warn("[AUDIO_DEBRIEF] Failed to cache streamed audio:", err);
      }
    })();

    return new Response(streamForClient as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-Audio-Cache": "MISS",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        ETag: `"${cacheKey}"`,
      },
    });
  }

  // If client explicitly requests JSON and upstream ElevenLabs synthesis failed
  if (request.headers.get("accept")?.includes("application/json")) {
    return NextResponse.json(
      {
        error: "Bad Gateway",
        message: "Failed to generate audio stream from upstream ElevenLabs service.",
      },
      { status: 502 },
    );
  }

  // Fallback playable MP3 audio buffer
  const fallbackBuffer = createFallbackAudioBuffer(briefText);
  await setCachedAudioDebrief(cacheKey, fallbackBuffer);

  return new Response(fallbackBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(fallbackBuffer.length),
      "X-Audio-Cache": "FALLBACK",
      "Cache-Control": "no-store",
    },
  });
}

export const GET = withRateLimit(
  handler as (req: NextRequest, ...args: unknown[]) => Promise<NextResponse>,
  { ...TIERS.AI_STREAM, keyPrefix: "audio-debrief:ip" },
) as typeof handler;

export const POST = GET;
