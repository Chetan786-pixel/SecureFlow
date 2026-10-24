/**
 * Redis Pub/Sub helpers for real-time voice alerts (#1307).
 *
 * The queue worker publishes an event here when a scan completes with
 * CRITICAL/HIGH findings or a BLOCK decision. The SSE endpoint subscribes
 * per-user and forwards events to the browser.
 *
 * We use the BullMQ Redis client (src/lib/queue/redis.ts) because it is
 * already configured with `maxRetriesPerRequest: null`, which is correct
 * for long-lived subscriber connections.
 *
 * Security: each channel is namespaced by userId so events never cross
 * user boundaries.
 */
import { redis } from "@/lib/queue/redis";
/** Redis channel name for a specific user's voice alerts. */
const alertChannel = (userId: string) => `voice-alert:${userId}`;
/** Shape of the event published to Redis and forwarded over SSE. */
export interface VoiceAlertEvent {
  /** "owner/repo" as reported by GitHub. */
  repositoryFullName: string;
  /** The PR number that triggered the scan. */
  prNumber: number;
  /** The policy decision that caused the alert. */
  decision: "BLOCK" | "REVIEW";
  /** The highest severity finding that crossed the threshold. */
  topSeverity: "CRITICAL" | "HIGH";
  /**
   * Dedup key — set to the webhook delivery ID so that BullMQ retries of
   * an already-processed job do not produce duplicate alerts in the browser.
   */
  alertId: string;
}
/**
 * Publish a voice alert event for a specific user.
 * Called by the queue worker after a scan result is persisted.
 * Non-throwing by design — caller wraps in .catch().
 */
export async function publishVoiceAlert(userId: string, event: VoiceAlertEvent): Promise<void> {
  await redis.publish(alertChannel(userId), JSON.stringify(event));
}
/**
 * Subscribe to voice alert events for a specific user.
 * Creates a dedicated subscriber connection (ioredis requires a separate
 * client for Pub/Sub — the subscribed client cannot run other commands).
 *
 * @returns cleanup function — call it to unsubscribe and disconnect.
 */
export function subscribeVoiceAlert(
  userId: string,
  onEvent: (event: VoiceAlertEvent) => void,
): () => void {
  // `duplicate()` creates a new connection with the same config.
  const subscriber = redis.duplicate();
  const channel = alertChannel(userId);

  // ioredis emits `error` on the subscriber connection for network failures and
  // reconnects. EventEmitter throws when an `error` event has no listener, which
  // would take down the process rather than leaving the stream to recover.
  subscriber.on("error", (err: Error) => {
    console.error(`[VoiceAlerts] Subscriber connection error on ${channel}:`, err);
  });

  subscriber.subscribe(channel, (err: Error | null) => {
    if (err) {
      console.error(`[VoiceAlerts] Failed to subscribe to ${channel}:`, err);
    }
  });
  subscriber.on("message", (receivedChannel: string, message: string) => {
    if (receivedChannel !== channel) return;
    try {
      const event = JSON.parse(message) as VoiceAlertEvent;
      onEvent(event);
    } catch (err) {
      console.warn("[VoiceAlerts] Failed to parse alert event:", err);
    }
  });
  // Return a cleanup function for the SSE route to call on request abort.
  return () => {
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.disconnect();
  };
}
