/**
 * Webhook Guard — Next.js middleware for inbound webhook signature validation.
 *
 * Wraps a Next.js route handler to enforce:
 * 1. A cap on the body size, checked before the body is buffered
 * 2. HMAC-SHA256 signature verification
 * 3. Timestamp-based replay protection (5-minute window)
 *
 * This module is the only caller of `admitWebhookRequest`, so it is where the
 * policy decisions live -- in particular the refusal to run at all without a
 * usable secret (#718). Node accepts an empty HMAC key, which means
 * `createHmac('sha256', '')` is an ordinary keyed digest that anyone can
 * compute; verifying against it admits every forged signature. A missing
 * secret is a deployment error, and it fails closed here rather than
 * degrading into an open endpoint.
 *
 * Usage:
 *   import { withWebhookGuard } from '@/lib/security/webhookGuard';
 *
 *   export const POST = withWebhookGuard(async (req, payload) => {
 *     // payload is the verified raw body -- the request stream is spent
 *   }, { secret: process.env.WEBHOOK_SECRET });
 */

import { NextRequest, NextResponse } from "next/server";
import { AppError } from "@/lib/middleware/error-handler";
import { readBoundedRequestBytes } from "@/lib/request-body";
import {
  admitWebhookRequest,
  signPayload,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  DEFAULT_REPLAY_WINDOW_SECONDS,
} from "./hmacSigner";

export interface WebhookGuardOptions {
  /**
   * The HMAC secret for signature verification.
   *
   * May be a getter, which is read once per request so that a value supplied
   * from `process.env` resolves against the live environment rather than
   * whatever was set when the module was first imported.
   *
   * `undefined`, empty and whitespace-only are all treated as "not
   * configured": the guard answers 500 and the handler never runs.
   */
  secret: string | undefined;
  /** Signature header name (default: X-SecureFlow-Signature). */
  signatureHeader?: string;
  /** Timestamp header name (default: X-SecureFlow-Timestamp). */
  timestampHeader?: string;
  /** Replay window in seconds (default: 300 = 5 minutes). */
  replayWindowSeconds?: number;
  /**
   * Largest body accepted, in bytes (default: {@link DEFAULT_MAX_WEBHOOK_BODY_BYTES}).
   * Like `secret`, read once per request, so it may be a getter.
   */
  maxBodyBytes?: number;
  /** Custom error handler. */
  onError?: (error: { status: number; message: string }) => NextResponse;
}

/**
 * Default cap on an inbound webhook body: 1 MiB.
 *
 * The body has to be read before the signature can be checked, so without a
 * cap anyone who can reach the endpoint can make the process buffer as much
 * as they care to send, with no secret at all. The rate limit bounds how
 * often, not how much. Alert payloads from the senders these routes serve are
 * a few kilobytes.
 */
export const DEFAULT_MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/**
 * Read a configured body cap such as `WEBHOOK_MAX_BYTES`, falling back to the
 * default for anything that is not a positive integer.
 */
export function resolveMaxWebhookBodyBytes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_WEBHOOK_BODY_BYTES;
  const parsed = Number(raw.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_WEBHOOK_BODY_BYTES;
}

const PAYLOAD_TOO_LARGE = {
  status: 413,
  message: "Webhook payload exceeds the configured size limit",
} as const;

/**
 * Read the body as raw bytes, enforcing the cap.
 *
 * `Content-Length` is checked first so a declared-oversized body is refused
 * without reading it. The bytes are then counted as they arrive, because the
 * header is absent on a chunked request and can be wrong on any request.
 * Returns `null` when the cap is exceeded.
 */
async function readCappedBody(req: NextRequest, maxBytes: number): Promise<Uint8Array | null> {
  try {
    return await readBoundedRequestBytes(req, maxBytes);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 413) return null;
    throw error;
  }
}

/**
 * The response a guarded route gives when no secret is configured.
 *
 * 500, not 401: the caller did nothing wrong, and telling them to fix their
 * signature would send them chasing a problem that is on this side. The body
 * says only that the endpoint is misconfigured -- never which variable, and
 * never any part of the secret.
 */
const MISCONFIGURED = {
  status: 500,
  message: "Webhook endpoint is not configured for signature verification",
} as const;

/**
 * Whether a secret is usable for HMAC.
 *
 * Whitespace-only counts as missing. A secret of `" "` almost always means an
 * env file with a trailing space on an otherwise empty assignment, and
 * treating it as real would key every signature off a single space character.
 */
export function isUsableSecret(secret: unknown): secret is string {
  return typeof secret === "string" && secret.trim().length > 0;
}

/**
 * Create a webhook-guarded route handler.
 *
 * The guard:
 * - Refuses to run without a usable secret
 * - Reads the request body up to the size cap (required for signature verification)
 * - Validates the HMAC signature over the bytes as received
 * - Checks the timestamp against the replay window
 * - Passes the verified payload to the handler as its second argument
 *
 * If any check fails, returns an appropriate HTTP error response.
 */
export function withWebhookGuard(
  handler: (req: NextRequest, payload: string) => Promise<NextResponse>,
  options: WebhookGuardOptions,
) {
  const {
    signatureHeader = SIGNATURE_HEADER,
    timestampHeader = TIMESTAMP_HEADER,
    replayWindowSeconds = DEFAULT_REPLAY_WINDOW_SECONDS,
    onError,
  } = options;

  const fail = (error: { status: number; message: string }): NextResponse =>
    onError
      ? onError(error)
      : NextResponse.json({ error: error.message }, { status: error.status });

  return async function guardedHandler(req: NextRequest): Promise<NextResponse> {
    // Read through the property rather than a value destructured above, so a
    // getter resolves against the environment as it is now. Destructuring at
    // wrapper-construction time would pin the value read at module load, which
    // in a serverless runtime is before the environment is necessarily
    // complete.
    const secret = options.secret;

    // Fail closed before any crypto runs. Verifying against an empty key is
    // not a weaker check, it is no check: the key is public, so any caller can
    // produce a digest that matches.
    if (!isUsableSecret(secret)) {
      return fail(MISCONFIGURED);
    }

    // Read the body first — signature is over the raw bytes, so those are
    // what gets verified. The handler gets them decoded.
    const body = await readCappedBody(req, options.maxBodyBytes ?? DEFAULT_MAX_WEBHOOK_BODY_BYTES);
    if (!body) {
      return fail(PAYLOAD_TOO_LARGE);
    }
    const payload = new TextDecoder().decode(body);

    // Run admission checks
    const result = admitWebhookRequest(
      body,
      secret,
      req.headers.get(signatureHeader),
      req.headers.get(timestampHeader),
      replayWindowSeconds,
    );

    if (!result.ok) {
      return fail(result);
    }

    // All checks passed — forward to the handler along with the body it can no
    // longer read for itself.
    return handler(req, payload);
  };
}

/**
 * Generate headers for an outbound webhook request.
 *
 * Signs the payload and adds both the signature and timestamp headers.
 *
 * @param payload - The raw payload string.
 * @param secret - The shared HMAC secret. Must be non-blank.
 * @param extraHeaders - Additional headers to include.
 * @returns Headers object with signature and timestamp headers set.
 * @throws If `secret` is missing, empty or whitespace-only. Emitting a
 *   signature under a key we do not have would produce a delivery that looks
 *   authenticated and is not, which is worse for the receiver than no
 *   signature header at all.
 */
export function signOutboundWebhook(
  payload: string,
  secret: string | undefined,
  extraHeaders?: Record<string, string>,
): Headers {
  if (!isUsableSecret(secret)) {
    throw new Error("Cannot sign an outbound webhook without a secret");
  }

  const timestampSeconds = Math.floor(Date.now() / 1000);
  const headers = new Headers(extraHeaders);
  headers.set(SIGNATURE_HEADER, signPayload(payload, secret, timestampSeconds));
  headers.set(TIMESTAMP_HEADER, String(timestampSeconds));
  headers.set("Content-Type", "application/json");

  return headers;
}

/** What `verifyWebhookRequest` reports back. */
export type WebhookVerification =
  { ok: true; payload: string; error: null } | { ok: false; payload: null; error: NextResponse };

/**
 * Verify a webhook request in a route handler.
 *
 * Returns the verified raw body on success, or the error response to return.
 *
 * The payload has to come back. `req.text()` spends the request's single-use
 * body stream, so before #718 a caller following the documented usage --
 * verify, then read the body -- got `''` or a throw on the *success* path, and
 * there was no correct way to call this function at all.
 *
 * Usage:
 *   const check = await verifyWebhookRequest(req, secret);
 *   if (!check.ok) return check.error;
 *   const event = JSON.parse(check.payload);
 */
export async function verifyWebhookRequest(
  req: NextRequest,
  secret: string | undefined,
  options?: {
    signatureHeader?: string;
    timestampHeader?: string;
    replayWindowSeconds?: number;
    maxBodyBytes?: number;
  },
): Promise<WebhookVerification> {
  const reject = (error: { status: number; message: string }): WebhookVerification => ({
    ok: false,
    payload: null,
    error: NextResponse.json({ error: error.message }, { status: error.status }),
  });

  if (!isUsableSecret(secret)) {
    return reject(MISCONFIGURED);
  }

  const body = await readCappedBody(req, options?.maxBodyBytes ?? DEFAULT_MAX_WEBHOOK_BODY_BYTES);
  if (!body) return reject(PAYLOAD_TOO_LARGE);
  const payload = new TextDecoder().decode(body);

  const result = admitWebhookRequest(
    body,
    secret,
    req.headers.get(options?.signatureHeader ?? SIGNATURE_HEADER),
    req.headers.get(options?.timestampHeader ?? TIMESTAMP_HEADER),
    options?.replayWindowSeconds,
  );

  if (!result.ok) return reject(result);

  return { ok: true, payload, error: null };
}
