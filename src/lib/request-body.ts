import { NextRequest } from "next/server";
import { AppError } from "@/lib/middleware/error-handler";

/**
 * Safely reads bounded request body bytes up to maxBytes without buffering excessive memory.
 * Rejects with HTTP 413 if the Content-Length header or streamed bytes exceed maxBytes.
 *
 * Returns the bytes exactly as received. A signature has to be verified over
 * those, not over a decoded string re-encoded as UTF-8: decoding replaces
 * invalid sequences, so the two differ for any body that is not valid UTF-8.
 */
export async function readBoundedRequestBytes(
  req: NextRequest | Request,
  maxBytes: number,
): Promise<Uint8Array> {
  // 1. Early Content-Length check: reject oversized requests before reading body stream
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      throw new AppError("Request payload exceeds maximum allowed size", 413);
    }
  }

  // 2. If streaming body reader is available, read chunk by chunk with early abort.
  //    Content-Length may be absent (chunked) or wrong, so the bytes actually
  //    received are counted regardless of what the header said.
  if (req.body && typeof req.body.getReader === "function") {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new AppError("Request payload exceeds maximum allowed size", 413);
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock?.();
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  // 3. Fallback for runtimes or mocks exposing req.text()
  if (typeof req.text === "function") {
    const bytes = new TextEncoder().encode(await req.text());
    if (bytes.byteLength > maxBytes) {
      throw new AppError("Request payload exceeds maximum allowed size", 413);
    }
    return bytes;
  }

  throw new AppError("Cannot read request body", 400);
}

/**
 * Safely reads bounded request body text up to maxBytes without buffering excessive memory.
 * Rejects with HTTP 413 if the Content-Length header or streamed bytes exceed maxBytes.
 */
export async function readBoundedRequestBody(
  req: NextRequest | Request,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder("utf-8").decode(await readBoundedRequestBytes(req, maxBytes));
}
