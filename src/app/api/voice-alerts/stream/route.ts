/**
 * GET /api/voice-alerts/stream
 *
 * Authenticated Server-Sent Events endpoint for real-time voice alerts (#1307).
 *
 * Security model:
 * - Requires an active session. Unauthenticated requests get 401.
 * - Events are scoped to the authenticated userId via a per-user Redis channel.
 *   A user can only receive alerts for their own repositories.
 * - Returns 204 No Content when the user has not opted in to voice alerts,
 *   so the client knows not to reconnect.
 */

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { subscribeVoiceAlert } from "@/lib/voice-alert-events";

export const dynamic = "force-dynamic";

/**
 * Idle interval for SSE keepalive frames.
 *
 * Proxies and load balancers commonly close connections that are silent for
 * 30-60 seconds. Voice alerts can be hours apart, so the stream needs a frame
 * on a shorter interval than the shortest typical idle timeout.
 */
export const VOICE_ALERT_HEARTBEAT_MS = 15_000;

export async function GET(request: NextRequest) {
  // 1. Authenticate
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const userId = session.user.id;

  // 2. Check opt-in preference — do not open a stream for opted-out users.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { voiceAlertsEnabled: true },
  });

  if (!user?.voiceAlertsEnabled) {
    return new Response(null, { status: 204 });
  }

  // 3. Build the SSE stream.
  let stopStream: ((closeController: boolean) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: () => void = () => {};

      const cleanup = (closeController: boolean) => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        if (closeController) {
          try {
            controller.close();
          } catch {
            // Already closed — safe to ignore.
          }
        }
      };

      /** Send one SSE event frame. */
      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // The controller is gone; release the Redis subscription too.
          cleanup(false);
        }
      };

      stopStream = cleanup;

      // Send an initial heartbeat so the browser knows the connection is live.
      send(JSON.stringify({ type: "connected" }));

      // Subscribe to the user's Redis channel.
      unsubscribe = subscribeVoiceAlert(userId, (event) => {
        send(JSON.stringify({ type: "voice-alert", ...event }));
      });

      // Keep idle connections alive through proxies that close silent streams.
      heartbeat = setInterval(() => {
        send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
      }, VOICE_ALERT_HEARTBEAT_MS);

      // Clean up when the client disconnects (tab closed, navigation, etc.).
      request.signal.addEventListener("abort", () => cleanup(true));
      if (request.signal.aborted) {
        cleanup(true);
      }
    },
    cancel() {
      // A consumer can cancel the body without aborting the request signal.
      stopStream?.(false);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
