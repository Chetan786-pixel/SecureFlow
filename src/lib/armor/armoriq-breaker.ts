/**
 * Circuit breaker for calls to the ArmorIQ control plane (#1376).
 *
 * ArmorIQ authorizes agent actions and the auto-remediation flow. When the
 * service is slow, rate-limited or down, every caller used to wait out its own
 * timeout and then fail on its own. This wraps those calls so that after a few
 * consecutive upstream failures the circuit opens and callers fail fast,
 * closed (the action is NOT authorized), until the service answers a probe.
 *
 * Only upstream faults (timeouts, rate limits, 5xx, network errors) trip the
 * breaker. A call that reaches ArmorIQ and is refused or rejected is a real
 * answer and resets it.
 */

import {
  CircuitBreakerError,
  getModelCircuitBreaker,
  isRateLimitError,
  isTimeoutError,
} from "@/ai/resilience";

/** Registry key for the shared ArmorIQ breaker. */
export const ARMORIQ_BREAKER_KEY = "armoriq:control-plane";

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;

/**
 * Thrown when the ArmorIQ circuit is open. Callers must treat it as "not
 * authorized": there is no allow-by-default fallback.
 */
export class ArmorIQUnavailableError extends Error {
  readonly status = 503;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArmorIQUnavailableError";
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const UPSTREAM_ERROR_NAMES = new Set(["ArmorIQTimeoutError", "ArmorIQUnreachableError"]);
const UPSTREAM_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * True for faults that mean ArmorIQ itself could not answer, as opposed to an
 * answer we did not like.
 */
export function isArmorIQUpstreamFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, code, status, statusCode } = error as {
    name?: string;
    code?: string;
    status?: number;
    statusCode?: number;
  };
  const httpStatus = status ?? statusCode;
  return (
    (typeof name === "string" && UPSTREAM_ERROR_NAMES.has(name)) ||
    (typeof code === "string" && UPSTREAM_ERROR_CODES.has(code)) ||
    (typeof httpStatus === "number" && httpStatus >= 500) ||
    isRateLimitError(error) ||
    isTimeoutError(error)
  );
}

/**
 * Runs an ArmorIQ call through the shared circuit breaker.
 *
 * Threshold and cool-down come from `ARMORIQ_CIRCUIT_FAILURE_THRESHOLD`
 * (default 3) and `ARMORIQ_CIRCUIT_RESET_TIMEOUT_MS` (default 30000) and are
 * read when the breaker is first created. Rejects with
 * {@link ArmorIQUnavailableError} while the circuit is open.
 */
export async function withArmorIQBreaker<T>(operation: () => Promise<T>): Promise<T> {
  const breaker = getModelCircuitBreaker(ARMORIQ_BREAKER_KEY, {
    failureThreshold: positiveInt(
      process.env.ARMORIQ_CIRCUIT_FAILURE_THRESHOLD,
      DEFAULT_FAILURE_THRESHOLD,
    ),
    resetTimeoutMs: positiveInt(
      process.env.ARMORIQ_CIRCUIT_RESET_TIMEOUT_MS,
      DEFAULT_RESET_TIMEOUT_MS,
    ),
  });

  try {
    const outcome = await breaker.execute(async () => {
      try {
        return { ok: true as const, value: await operation() };
      } catch (error) {
        // Let upstream faults count against the breaker; hand anything else
        // back as a normal answer so it does not.
        if (isArmorIQUpstreamFailure(error)) throw error;
        return { ok: false as const, error };
      }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  } catch (error) {
    if (error instanceof CircuitBreakerError) {
      throw new ArmorIQUnavailableError(
        "ArmorIQ is temporarily unavailable (circuit open); the action is not authorized",
        { cause: error },
      );
    }
    throw error;
  }
}
