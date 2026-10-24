import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { duplicateMock } = vi.hoisted(() => ({
  duplicateMock: vi.fn(),
}));

vi.mock("@/lib/queue/redis", () => ({
  redis: {
    duplicate: duplicateMock,
  },
}));

import { subscribeVoiceAlert, type VoiceAlertEvent } from "./voice-alert-events";

class FakeSubscriber extends EventEmitter {
  subscribe = vi.fn((_channel: string, callback: (error: Error | null) => void) => {
    callback(null);
  });
  unsubscribe = vi.fn(async () => 1);
  disconnect = vi.fn();
}

function makeEvent(overrides: Partial<VoiceAlertEvent> = {}): VoiceAlertEvent {
  return {
    repositoryFullName: "acme/web",
    prNumber: 101,
    decision: "BLOCK",
    topSeverity: "CRITICAL",
    alertId: "alert-1",
    ...overrides,
  };
}

describe("subscribeVoiceAlert", () => {
  let subscriber: FakeSubscriber;

  beforeEach(() => {
    subscriber = new FakeSubscriber();
    duplicateMock.mockReturnValue(subscriber);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("subscribes to the user-scoped channel and forwards matching events", () => {
    const onEvent = vi.fn();
    subscribeVoiceAlert("user-1", onEvent);

    expect(subscriber.subscribe).toHaveBeenCalledWith("voice-alert:user-1", expect.any(Function));

    const event = makeEvent();
    subscriber.emit("message", "voice-alert:user-1", JSON.stringify(event));
    expect(onEvent).toHaveBeenCalledWith(event);

    subscriber.emit(
      "message",
      "voice-alert:user-2",
      JSON.stringify(makeEvent({ alertId: "other" })),
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("does not crash when the Redis subscriber emits an error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    subscribeVoiceAlert("user-1", vi.fn());

    const error = new Error("connection reset by peer");
    expect(() => subscriber.emit("error", error)).not.toThrow();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Subscriber connection error on voice-alert:user-1"),
      error,
    );
  });

  it("logs subscribe failures without throwing", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const subscribeError = new Error("NOAUTH");
    subscriber.subscribe.mockImplementationOnce((_channel, callback) => callback(subscribeError));

    expect(() => subscribeVoiceAlert("user-1", vi.fn())).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to subscribe to voice-alert:user-1"),
      subscribeError,
    );
  });

  it("ignores malformed messages and logs a warning", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onEvent = vi.fn();
    subscribeVoiceAlert("user-1", onEvent);

    expect(() => subscriber.emit("message", "voice-alert:user-1", "{not-json")).not.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      "[VoiceAlerts] Failed to parse alert event:",
      expect.any(SyntaxError),
    );
  });

  it("unsubscribes and disconnects on cleanup", () => {
    const cleanup = subscribeVoiceAlert("user-1", vi.fn());

    cleanup();

    expect(subscriber.unsubscribe).toHaveBeenCalledWith("voice-alert:user-1");
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
  });
});
