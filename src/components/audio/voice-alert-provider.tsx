/**
 * VoiceAlertProvider (#1307)
 *
 * Client component that connects to /api/voice-alerts/stream and plays
 * synthesized audio when the server publishes a critical security alert.
 *
 * Behaviour:
 * - Only opens an SSE connection when voiceAlertsEnabled is true.
 * - Deduplicates events by alertId so BullMQ job retries never play twice.
 * - Falls back to a visible sonner toast when the browser blocks autoplay.
 * - Cleans up the EventSource on unmount or when the user opts out.
 */
"use client";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
export interface VoiceAlertProviderProps {
  voiceAlertsEnabled: boolean;
  children: React.ReactNode;
}
export function VoiceAlertProvider({ voiceAlertsEnabled, children }: VoiceAlertProviderProps) {
  // Track already-played alertIds to suppress duplicates from job retries.
  const seenAlertIds = useRef<Set<string>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  useEffect(() => {
    // Do nothing if the user has not opted in.
    if (!voiceAlertsEnabled) return;
    // Open the authenticated SSE stream.
    const es = new EventSource("/api/voice-alerts/stream");
    eventSourceRef.current = es;
    es.onmessage = async (e: MessageEvent) => {
      let payload: Record<string, string>;
      try {
        payload = JSON.parse(e.data as string);
      } catch {
        return;
      }
      // Ignore the initial "connected" heartbeat.
      if (payload.type === "connected") return;
      if (payload.type !== "voice-alert") return;
      const { alertId, repositoryFullName, decision, topSeverity } = payload;
      // Deduplicate.
      if (!alertId || seenAlertIds.current.has(alertId)) return;
      seenAlertIds.current.add(alertId);
      // Always show a visible toast so the alert is never silent-only.
      const toastMessage =
        decision === "BLOCK"
          ? `🚨 Deployment blocked in ${repositoryFullName} — ${topSeverity} severity finding detected.`
          : `⚠️ Critical finding in ${repositoryFullName} — manual review required.`;
      toast.error(toastMessage, { duration: 10000 });
      // Attempt audio playback.
      try {
        const params = new URLSearchParams({
          repo: repositoryFullName,
          decision,
          severity: topSeverity,
        });
        const audioRes = await fetch(`/api/voice-alerts/audio?${params.toString()}`);
        if (!audioRes.ok) return;
        const blob = await audioRes.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.addEventListener("ended", () => URL.revokeObjectURL(url));
        await audio.play();
      } catch (playErr) {
        // Autoplay was blocked or audio fetch failed — the toast above
        // already informed the user, so this is a silent fallback.
        console.warn("[VoiceAlerts] Audio playback failed (autoplay policy?):", playErr);
      }
    };
    es.onerror = () => {
      // EventSource will automatically reconnect on transient errors.
      // No manual retry needed.
      console.warn("[VoiceAlerts] SSE connection error — browser will retry.");
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [voiceAlertsEnabled]);
  return <>{children}</>;
}
