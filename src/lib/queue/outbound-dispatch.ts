/**
 * Outbound webhook dispatch (#642).
 *
 * `outboundWorker.ts` used to be eight lines of `fetch(url, { method: 'POST' })`
 * where `url` came out of the job payload. That is the most dangerous shape a
 * background worker can have: it runs inside our network, with Redis and
 * Postgres reachable, and it will connect to whatever address a job names.
 *
 * Everything here exists to bound one of the four things that were unbounded:
 *
 *  1. **Where we connect.** {@link assertDispatchableUrl} rejects non-HTTP
 *     schemes, rejects plaintext HTTP outside development, and rejects any
 *     destination that resolves into a private, loopback, link-local or
 *     otherwise internal range — the cloud metadata service at
 *     `169.254.169.254` being the one that actually gets exploited.
 *  2. **How long we wait.** Every request carries a deadline. BullMQ has no
 *     job timeout of its own, so without this a receiver that accepts the
 *     connection and never answers holds a worker slot until the process
 *     restarts, while the job sits in `active` where no alert will find it.
 *  3. **How much we read.** The old code never touched `response.body`, which
 *     under undici keeps the socket alive until GC. We now drain a bounded
 *     prefix and release the rest.
 *  4. **How often we retry.** A 404 is not going to become a 200 on the third
 *     attempt. {@link classifyResponseStatus} separates the outcomes worth
 *     retrying from the ones that only cost us backoff.
 *
 * DNS is resolved before the socket is opened and the *resolved addresses* are
 * checked, not just the hostname. A name that looks external and answers with
 * `127.0.0.1` is the standard way around a hostname allowlist.
 *
 * The socket is then opened to one of exactly those addresses
 * ({@link pinnedTransport}). Checking the answer and then handing the hostname
 * to `fetch` would resolve it a second time, and a DNS server with a zero TTL
 * can answer the check with a public address and the connection with
 * `169.254.169.254`. Only address resolution is replaced: TLS still verifies
 * the certificate against the hostname, SNI still carries it, and the `Host`
 * header is unchanged.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { LookupAddress } from "dns";
import { lookup as dnsLookup } from "dns/promises";
import http from "http";
import https from "https";
import { isIP, type LookupFunction } from "net";
import { Readable } from "stream";

/** Default per-request deadline. Generous for a webhook, far short of forever. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Hard ceiling on a configured timeout, so an env typo cannot restore the old behaviour. */
export const MAX_TIMEOUT_MS = 60_000;

/** Bytes of the response we are willing to read before hanging up. */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/** Version tag on the signature header, so the scheme can change without breaking receivers. */
export const SIGNATURE_VERSION = "v1";

/** Header names, exported so tests and receivers agree on the spelling. */
export const SIGNATURE_HEADER = "X-SecureFlow-Signature";
export const TIMESTAMP_HEADER = "X-SecureFlow-Timestamp";
export const DELIVERY_HEADER = "X-SecureFlow-Delivery";

/**
 * Hostnames that name the machine or the platform rather than a peer.
 *
 * `metadata.google.internal` is listed explicitly because it resolves to a
 * link-local address only from inside GCP — a check that ran on a developer
 * laptop would see NXDOMAIN and wave it through.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/**
 * Raised when a destination is refused before any connection is attempted.
 *
 * Always permanent: a job pointed at `127.0.0.1` will still be pointed at
 * `127.0.0.1` on the next attempt.
 */
export class OutboundDestinationError extends Error {
  public readonly retryable = false as const;

  constructor(message: string) {
    super(message);
    this.name = "OutboundDestinationError";
    Object.setPrototypeOf(this, OutboundDestinationError.prototype);
  }
}

/** Raised when a dispatch was attempted and did not succeed. */
export class OutboundDeliveryError extends Error {
  public readonly retryable: boolean;
  public readonly status?: number;

  constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "OutboundDeliveryError";
    this.retryable = retryable;
    this.status = status;
    Object.setPrototypeOf(this, OutboundDeliveryError.prototype);
  }
}

export interface DispatchConfig {
  /** Per-request deadline in milliseconds. */
  timeoutMs: number;
  /** Bytes of response body read before the connection is released. */
  maxResponseBytes: number;
  /** When non-empty, only these hostnames may be dispatched to. */
  allowedHosts: string[];
  /** Permit plaintext `http://`. Development only. */
  allowInsecureHttp: boolean;
  /** Permit private / loopback destinations. Development and self-hosted test rigs only. */
  allowPrivateNetworks: boolean;
}

function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseBoolean(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

/**
 * Read the dispatch policy from the environment.
 *
 * The permissive switches (`ALLOW_INSECURE_HTTP`, `ALLOW_PRIVATE_NETWORKS`) are
 * ignored entirely when `NODE_ENV === 'production'`. An operator cannot turn off
 * the SSRF guard in production by setting an environment variable, which is
 * exactly how these guards usually end up disabled.
 */
export function resolveDispatchConfig(env: NodeJS.ProcessEnv = process.env): DispatchConfig {
  const isProduction = env.NODE_ENV === "production";

  const allowedHosts = (env.OUTBOUND_WEBHOOK_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);

  return {
    timeoutMs: parsePositiveInt(
      env.OUTBOUND_WEBHOOK_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    maxResponseBytes: parsePositiveInt(
      env.OUTBOUND_WEBHOOK_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      1024 * 1024,
    ),
    allowedHosts,
    allowInsecureHttp: !isProduction && parseBoolean(env.OUTBOUND_WEBHOOK_ALLOW_INSECURE_HTTP),
    allowPrivateNetworks:
      !isProduction && parseBoolean(env.OUTBOUND_WEBHOOK_ALLOW_PRIVATE_NETWORKS),
  };
}

/** Parse a dotted-quad into its four octets, or null if it is not one. */
function parseIPv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    // Reject `01`, `+1`, `0x7f` and friends: they parse differently in different
    // resolvers, which is how an "obviously public" literal becomes loopback.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }

  return octets;
}

/**
 * True when an IPv4 literal names something that is not a public peer.
 *
 * Covers the ranges that matter for SSRF rather than every reservation in the
 * registry: loopback, the two RFC1918 blocks plus 172.16/12, link-local (which
 * is where every cloud metadata service lives), carrier-grade NAT, the
 * benchmarking and documentation blocks, multicast, and the reserved 240/4.
 */
export function isPrivateIPv4(value: string): boolean {
  const octets = parseIPv4(value);
  if (!octets) return false;

  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0/24 and 192.0.2/24
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100/24 documentation
  if (a === 203 && b === 0) return true; // 203.0.113/24 documentation
  if (a >= 224) return true; // multicast (224/4) and reserved (240/4)

  return false;
}

/** Render two hextets as a dotted quad. */
function hextetsToIPv4(high: number, low: number): string {
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/**
 * Expand an IPv6 literal into its eight hextets, or null if it is not one.
 *
 * Accepts `::` compression and a trailing dotted quad (`::ffff:1.2.3.4`).
 */
function parseIPv6(value: string): number[] | null {
  let text = value;
  let tail: number[] | null = null;

  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = parseIPv4(dotted[2]);
    if (!octets) return null;
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    text = `${dotted[1]}0:0`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const toHextets = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));

  const head = toHextets(halves[0]);
  const rest = halves.length === 2 ? toHextets(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;

  let hextets: number[];
  if (halves.length === 2) {
    const gap = 8 - head.length - rest.length;
    if (gap < 1) return null;
    hextets = [...head, ...new Array<number>(gap).fill(0), ...rest];
  } else {
    if (head.length !== 8) return null;
    hextets = head;
  }

  if (tail) {
    hextets[6] = tail[0];
    hextets[7] = tail[1];
  }
  return hextets;
}

/**
 * True when an IPv6 literal names something that is not a public peer.
 *
 * Every format that carries an IPv4 address is unwrapped and the IPv4 address
 * is checked instead: IPv4-mapped, IPv4-compatible, SIIT, NAT64 (`64:ff9b::/96`)
 * and 6to4 (`2002::/16`). Skipping that step is the most common way an
 * IPv6-aware blocklist gets bypassed. The check runs on parsed hextets, not on
 * the spelling: the WHATWG URL parser rewrites `::ffff:127.0.0.1` to
 * `::ffff:7f00:1`, and `getaddrinfo` returns NAT64 answers as
 * `64:ff9b::a9fe:a9fe`, so a pattern on the dotted form catches neither.
 *
 * Anything that does not parse is treated as private.
 */
export function isPrivateIPv6(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];

  // A dotted quad trailing an arbitrary prefix is how a 6to4 or NAT64 address
  // is usually written by hand.
  const trailing = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (trailing && isPrivateIPv4(trailing[1])) return true;

  const h = parseIPv6(normalized);
  if (!h) return true;

  const zeroUpTo = (count: number) => h.slice(0, count).every((hextet) => hextet === 0);
  const embedded = (from: number) => hextetsToIPv4(h[from], h[from + 1]);

  if (zeroUpTo(7) && (h[7] === 0 || h[7] === 1)) return true; // :: and ::1
  if (zeroUpTo(5) && (h[5] === 0xffff || h[5] === 0)) return isPrivateIPv4(embedded(6)); // mapped, compatible
  if (zeroUpTo(4) && h[4] === 0xffff && h[5] === 0) return isPrivateIPv4(embedded(6)); // SIIT
  if (h[0] === 0x64 && h[1] === 0xff9b) {
    // 64:ff9b::/96 translates to the IPv4 address in its last 32 bits. The
    // rest of 64:ff9b::/32, including local-use 64:ff9b:1::/48, translates to
    // wherever the operator chose, so none of it is treated as public.
    return h.slice(2, 6).every((hextet) => hextet === 0) ? isPrivateIPv4(embedded(6)) : true;
  }
  if (h[0] === 0x2002) return isPrivateIPv4(embedded(1)); // 6to4
  if (h[0] === 0x2001 && h[1] === 0) return true; // Teredo: carries an obfuscated IPv4 client
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x0100 && h.slice(1, 4).every((hextet) => hextet === 0)) return true; // 100::/64 discard
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated, still routed by some stacks)
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

/** True for any address literal we refuse to connect to. */
export function isPrivateAddress(value: string): boolean {
  if (!value) return true;
  return value.includes(":") ? isPrivateIPv6(value) : isPrivateIPv4(value);
}

/** True when a hostname names the local machine or a platform metadata service. */
export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  // `.localhost` and `.internal` are reserved for exactly this purpose.
  return normalized.endsWith(".localhost") || normalized.endsWith(".internal");
}

/**
 * Human-readable destination with no secret material.
 *
 * Most webhook providers put a token in the path or the query string, so the
 * full URL must never reach a log. Scheme, host and port are enough to debug a
 * delivery failure.
 */
export function describeDestination(url: URL): string {
  return url.port
    ? `${url.protocol}//${url.hostname}:${url.port}`
    : `${url.protocol}//${url.hostname}`;
}

/** Resolves a hostname to address literals. Injected so tests never touch DNS. */
export type AddressResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: AddressResolver = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
};

export interface ValidateDestinationOptions {
  config?: DispatchConfig;
  resolve?: AddressResolver;
}

/** A destination that passed {@link resolveDispatchTarget}. */
export interface DispatchTarget {
  url: URL;
  /**
   * The addresses the hostname resolved to when it was checked. The
   * connection must go to one of these, and the name must not be resolved
   * again. `null` when there is nothing to pin: the host is an address literal
   * (already checked), or private networks are allowed outside production.
   */
  addresses: string[] | null;
}

/**
 * Validate a destination and return the parsed URL, or throw.
 *
 * Kept for callers that only need the verdict. Dispatch uses
 * {@link resolveDispatchTarget}, because connecting to the URL's hostname
 * after this returns would resolve it again.
 */
export async function assertDispatchableUrl(
  rawUrl: string,
  options: ValidateDestinationOptions = {},
): Promise<URL> {
  return (await resolveDispatchTarget(rawUrl, options)).url;
}

/**
 * Validate a destination and return it with the addresses that were checked.
 *
 * The order matters. Syntax and scheme are cheap and are checked first; the
 * allowlist is checked before DNS so an allowlisted deployment never pays for a
 * lookup it is going to ignore; the resolved addresses are checked last because
 * that is the only step that can fail for reasons unrelated to the URL.
 */
export async function resolveDispatchTarget(
  rawUrl: string,
  options: ValidateDestinationOptions = {},
): Promise<DispatchTarget> {
  const config = options.config ?? resolveDispatchConfig();
  const resolve = options.resolve ?? defaultResolver;

  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new OutboundDestinationError("Webhook URL is missing.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new OutboundDestinationError("Webhook URL is not a valid absolute URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OutboundDestinationError(
      `Unsupported webhook scheme "${url.protocol}" — only http and https are dispatchable.`,
    );
  }

  if (url.protocol === "http:" && !config.allowInsecureHttp) {
    throw new OutboundDestinationError(
      "Refusing to dispatch a webhook over plaintext http. Use https.",
    );
  }

  // Credentials in the authority are never meaningful for a webhook and are a
  // reliable sign the URL was assembled from somewhere it should not have been.
  if (url.username || url.password) {
    throw new OutboundDestinationError("Webhook URL must not embed credentials.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (config.allowedHosts.length > 0 && !config.allowedHosts.includes(hostname)) {
    throw new OutboundDestinationError(
      `Host "${hostname}" is not in OUTBOUND_WEBHOOK_ALLOWED_HOSTS.`,
    );
  }

  if (config.allowPrivateNetworks) {
    return { url, addresses: null };
  }

  if (isBlockedHostname(hostname)) {
    throw new OutboundDestinationError(`Refusing to dispatch to internal host "${hostname}".`);
  }

  // A literal address needs no lookup, and passing one to the resolver would
  // just hand it straight back.
  if (isPrivateAddress(hostname)) {
    throw new OutboundDestinationError(
      `Refusing to dispatch to private or reserved address "${hostname}".`,
    );
  }

  if (isIP(hostname) !== 0) {
    return { url, addresses: null };
  }

  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    // A name we cannot resolve is not a name we should connect to. Retryable,
    // because DNS failures are usually transient.
    throw new OutboundDeliveryError(`Could not resolve webhook host "${hostname}".`, true);
  }

  if (addresses.length === 0) {
    throw new OutboundDeliveryError(`Webhook host "${hostname}" resolved to no addresses.`, true);
  }

  const internal = addresses.find((address) => isIP(address) === 0 || isPrivateAddress(address));
  if (internal) {
    throw new OutboundDestinationError(
      `Host "${hostname}" resolves to the internal address ${internal}.`,
    );
  }

  return { url, addresses };
}

/**
 * Build the signature for a payload.
 *
 * Signed over `${timestamp}.${body}` rather than the body alone so a receiver
 * can reject a replay by rejecting an old timestamp — the old bare-body HMAC
 * was valid forever. The `t=`/`v1=` shape lets the algorithm be rotated without
 * a receiver having to guess which one it is looking at.
 */
export function buildSignatureHeader(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},${SIGNATURE_VERSION}=${digest}`;
}

/**
 * Verify a signature header. Provided so receivers in this repo (and the tests)
 * do not each hand-roll the comparison and get the timing wrong.
 */
export function verifySignatureHeader(
  header: string,
  secret: string,
  body: string,
  toleranceSeconds = 300,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = new Map(
    header
      .split(",")
      .map((segment) => segment.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );

  const timestamp = Number(parts.get("t"));
  const provided = parts.get(SIGNATURE_VERSION);
  if (!Number.isFinite(timestamp) || !provided) return false;
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type StatusClass = "success" | "retryable" | "permanent";

/**
 * Decide what an HTTP status means for a retry.
 *
 * 3xx is deliberately permanent: we dispatch with `redirect: 'manual'`, so a
 * redirect is a receiver telling us to connect somewhere we have not validated.
 * Following it would undo the whole destination check, and retrying it would
 * just produce the same redirect.
 */
export function classifyResponseStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) return "success";
  if (status === 408 || status === 425 || status === 429) return "retryable";
  if (status >= 500) return "retryable";
  return "permanent";
}

/**
 * Read at most `limit` bytes of a response and release the connection.
 *
 * Returning the prefix is worth the small cost: a receiver's error body is
 * usually the only explanation of why a delivery failed, and without it the DLQ
 * entry says nothing more than "400".
 */
export async function drainBody(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = limit - total;
      chunks.push(value.length > remaining ? value.subarray(0, remaining) : value);
      total += Math.min(value.length, remaining);
    }
  } catch {
    // A body that fails mid-read tells us nothing useful; the status already did.
  } finally {
    // Releases the socket whether we read all of it or gave up at the cap.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(merged);
}

/** Address family as `net` reports it: 4, 6, or 0 for "either". */
function lookupFamily(family: number | string | undefined): 0 | 4 | 6 {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return 0;
}

/**
 * A `lookup` for `net.connect` that answers with addresses already validated
 * for `hostname`, and never queries DNS.
 *
 * Handles both calling conventions `net` uses: a single address, and
 * `{ all: true }` when happy-eyeballs (`autoSelectFamily`, on by default since
 * Node 20) wants every candidate. Asked about any other name, it fails rather
 * than resolving it: a connection to an unvalidated name is the failure this
 * exists to prevent.
 */
export function createPinnedLookup(hostname: string, addresses: string[]): LookupFunction {
  const pinnedHost = hostname.toLowerCase();
  const records: LookupAddress[] = addresses
    .map((address) => ({ address, family: isIP(address) }))
    .filter((record) => record.family !== 0);

  return (requested, options, callback) => {
    const family = lookupFamily(options?.family);
    const candidates =
      requested.toLowerCase() === pinnedHost
        ? records.filter((record) => family === 0 || record.family === family)
        : [];

    if (candidates.length === 0) {
      const error: NodeJS.ErrnoException = new Error(
        `No validated address for "${requested}"; refusing to resolve it at connect time.`,
      );
      error.code = "ENOTFOUND";
      callback(error, options?.all ? [] : "", 0);
      return;
    }

    if (options?.all) {
      callback(null, candidates);
    } else {
      callback(null, candidates[0].address, candidates[0].family);
    }
  };
}

/** Request options {@link pinnedTransport} honours. */
export interface TransportInit {
  method?: string;
  headers?: HeadersInit;
  body?: string;
  signal?: AbortSignal;
}

/**
 * Sends a request. The default, {@link pinnedTransport}, connects only to
 * `target.addresses`; a replacement has to honour them itself.
 */
export type DispatchTransport = (
  url: string,
  init: TransportInit & RequestInit,
  target: DispatchTarget,
) => Promise<Response>;

/** Statuses whose response may not carry a body under the Fetch spec. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** Wrap a Node response as a Fetch `Response` so the rest of dispatch is transport-agnostic. */
function toFetchResponse(message: http.IncomingMessage): Response {
  const status = message.statusCode ?? 0;
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }

  if (NULL_BODY_STATUSES.has(status)) {
    message.resume();
    return new Response(null, { status, statusText: message.statusMessage, headers });
  }

  return new Response(Readable.toWeb(message) as ReadableStream<Uint8Array>, {
    status,
    statusText: message.statusMessage,
    headers,
  });
}

/**
 * Send one request over a connection to a validated address.
 *
 * Built on `http`/`https` rather than `fetch` because the global `fetch` has no
 * supported way to control address resolution for a single request. The
 * `lookup` hook replaces resolution and nothing else: the hostname is still
 * what `tls.connect` uses for SNI and certificate verification, and still what
 * the `Host` header carries.
 *
 * `agent: false` gives the request a fresh, non-pooled agent. A keep-alive
 * socket opened elsewhere to the same host:port would have been connected by
 * a lookup we did not control.
 *
 * Redirects are never followed; `http.request` has no such behaviour.
 */
export function pinnedTransport(
  url: string,
  init: TransportInit,
  target: DispatchTarget,
): Promise<Response> {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  if (init.body !== undefined) {
    headers["content-length"] = String(Buffer.byteLength(init.body));
  }

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      parsed,
      {
        method: init.method ?? "GET",
        headers,
        agent: false,
        signal: init.signal,
        ...(target.addresses ? { lookup: createPinnedLookup(hostname, target.addresses) } : {}),
      },
      (message) => {
        try {
          resolve(toFetchResponse(message));
        } catch (error) {
          message.destroy();
          reject(error);
        }
      },
    );

    request.on("error", reject);
    request.end(init.body);
  });
}

export interface OutboundWebhookRequest {
  url: string;
  payload: Record<string, unknown> | string;
  secret?: string;
  /** Correlates the delivery across our logs and the receiver's. */
  deliveryId?: string;
}

export interface DispatchOptions {
  config?: DispatchConfig;
  resolve?: AddressResolver;
  /**
   * Replaces {@link pinnedTransport}. Injected so tests do not need a live
   * socket; anything else passed here is responsible for connecting only to
   * `target.addresses`.
   */
  fetchImpl?: DispatchTransport;
  now?: () => number;
  /** Injected so a signature can be asserted deterministically. */
  deliveryId?: string;
}

export interface DispatchResult {
  status: number;
  destination: string;
  deliveryId: string;
  durationMs: number;
  /** Bounded prefix of the receiver's response, for diagnostics. */
  bodyPreview: string;
}

/**
 * Dispatch one outbound webhook.
 *
 * Throws {@link OutboundDestinationError} for a destination we refuse outright
 * and {@link OutboundDeliveryError} for an attempt that failed, with
 * `retryable` set so the worker can decide between a retry and the DLQ.
 */
export async function dispatchOutboundWebhook(
  request: OutboundWebhookRequest,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const config = options.config ?? resolveDispatchConfig();
  const doFetch = options.fetchImpl ?? pinnedTransport;
  const now = options.now ?? Date.now;

  const target = await resolveDispatchTarget(request.url, { config, resolve: options.resolve });
  const { url } = target;
  const destination = describeDestination(url);
  const deliveryId = options.deliveryId ?? request.deliveryId ?? randomUUID();

  const body =
    typeof request.payload === "string" ? request.payload : JSON.stringify(request.payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "SecureFlow-Webhooks/1.0",
    [DELIVERY_HEADER]: deliveryId,
  };

  if (request.secret) {
    const timestamp = Math.floor(now() / 1000);
    headers[TIMESTAMP_HEADER] = String(timestamp);
    headers[SIGNATURE_HEADER] = buildSignatureHeader(request.secret, body, timestamp);
  }

  const startedAt = now();
  let response: Response;

  try {
    response = await doFetch(
      url.toString(),
      {
        method: "POST",
        headers,
        body,
        // A 3xx is a destination we have not validated. Never follow it.
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      },
      target,
    );
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

    throw new OutboundDeliveryError(
      isTimeout
        ? `Webhook to ${destination} timed out after ${config.timeoutMs}ms.`
        : `Webhook to ${destination} failed: ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }

  const bodyPreview = await drainBody(response, config.maxResponseBytes);
  const durationMs = now() - startedAt;
  const outcome = classifyResponseStatus(response.status);

  if (outcome === "success") {
    return { status: response.status, destination, deliveryId, durationMs, bodyPreview };
  }

  const redirected = response.status >= 300 && response.status < 400;
  throw new OutboundDeliveryError(
    redirected
      ? `Webhook to ${destination} returned a ${response.status} redirect, which is not followed.`
      : `Webhook to ${destination} failed with HTTP ${response.status}.`,
    outcome === "retryable",
    response.status,
  );
}
