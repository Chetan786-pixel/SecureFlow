import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import http from "http";
import https from "https";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import path from "path";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  OutboundDeliveryError,
  OutboundDestinationError,
  SIGNATURE_HEADER,
  createPinnedLookup,
  dispatchOutboundWebhook,
  pinnedTransport,
  resolveDispatchTarget,
  verifySignatureHeader,
  type DispatchConfig,
  type DispatchTarget,
  type DispatchTransport,
} from "./outbound-dispatch";

/**
 * Connection-time pinning: the socket must go to an address that passed the
 * destination checks, never to whatever a second DNS query returns.
 *
 * Every server here listens on loopback. Hostnames under `.test` cannot
 * resolve, so a request that reaches a server proves the connection used the
 * pinned address and did not query DNS.
 */

function config(overrides: Partial<DispatchConfig> = {}): DispatchConfig {
  return {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    allowedHosts: [],
    allowInsecureHttp: true,
    allowPrivateNetworks: false,
    ...overrides,
  };
}

const PUBLIC_ADDRESS = "93.184.216.34";

interface Received {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

/** Start a loopback server and record every request it receives. */
async function startServer(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) =>
    res.end("accepted"),
  server: http.Server = http.createServer(),
): Promise<{ port: number; received: Received[] }> {
  const received: Received[] = [];
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      respond(req, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, received };
}

const loopbackTarget = (url: string): DispatchTarget => ({
  url: new URL(url),
  addresses: ["127.0.0.1"],
});

describe("createPinnedLookup", () => {
  const lookup = createPinnedLookup("hooks.example.test", ["203.0.113.80", "2001:4860::8888"]);

  const call = (hostname: string, options: Record<string, unknown>) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>(
      (resolve) => {
        lookup(hostname, options as never, (error, address, family) =>
          resolve({ error, address, family }),
        );
      },
    );

  it("answers with the first pinned address", async () => {
    const { error, address, family } = await call("hooks.example.test", {});
    expect(error).toBeNull();
    expect(address).toBe("203.0.113.80");
    expect(family).toBe(4);
  });

  it("answers with every pinned address when net asks for all of them", async () => {
    const { address } = await call("hooks.example.test", { all: true });
    expect(address).toEqual([
      { address: "203.0.113.80", family: 4 },
      { address: "2001:4860::8888", family: 6 },
    ]);
  });

  it("honours a requested address family", async () => {
    expect((await call("hooks.example.test", { family: 6 })).address).toBe("2001:4860::8888");
    expect((await call("hooks.example.test", { family: "IPv4" })).address).toBe("203.0.113.80");
  });

  it("is case-insensitive about the hostname", async () => {
    expect((await call("HOOKS.example.TEST", {})).error).toBeNull();
  });

  it("refuses any other hostname instead of resolving it", async () => {
    const { error } = await call("attacker.example.test", {});
    expect(error?.code).toBe("ENOTFOUND");
  });

  it("fails when no pinned address matches the requested family", async () => {
    const v4Only = createPinnedLookup("hooks.example.test", ["203.0.113.80"]);
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      v4Only("hooks.example.test", { family: 6 }, (err) => resolve(err)),
    );
    expect(error?.code).toBe("ENOTFOUND");
  });
});

describe("resolveDispatchTarget", () => {
  it("returns the addresses it validated so the connection can use them", async () => {
    const resolve = vi.fn(async () => [PUBLIC_ADDRESS]);
    const target = await resolveDispatchTarget("https://hooks.example.test/hook", {
      config: config(),
      resolve,
    });

    expect(target.url.hostname).toBe("hooks.example.test");
    expect(target.addresses).toEqual([PUBLIC_ADDRESS]);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("has nothing to pin for an address literal", async () => {
    const target = await resolveDispatchTarget(`https://${PUBLIC_ADDRESS}/hook`, {
      config: config(),
      resolve: vi.fn(),
    });
    expect(target.addresses).toBeNull();
  });

  it("refuses a resolver answer that is not an IP address", async () => {
    await expect(
      resolveDispatchTarget("https://hooks.example.test/hook", {
        config: config(),
        resolve: async () => ["internal.example.test"],
      }),
    ).rejects.toBeInstanceOf(OutboundDestinationError);
  });

  it.each([
    ["IPv4 loopback", ["127.0.0.1"]],
    ["IPv4 metadata", ["169.254.169.254"]],
    ["IPv6 loopback", ["::1"]],
    ["IPv6 unique-local", ["fd00::1"]],
    ["NAT64 of the metadata service", ["64:ff9b::a9fe:a9fe"]],
    ["IPv4-mapped loopback", ["::ffff:7f00:1"]],
    ["a private address among public ones", [PUBLIC_ADDRESS, "10.0.0.7"]],
  ])("refuses a name that resolves to %s", async (_label, addresses) => {
    await expect(
      resolveDispatchTarget("https://hooks.example.test/hook", {
        config: config(),
        resolve: async () => addresses,
      }),
    ).rejects.toBeInstanceOf(OutboundDestinationError);
  });
});

describe("dispatchOutboundWebhook against DNS rebinding", () => {
  it("connects to the address it validated, not to a second answer", async () => {
    // A rebinding resolver: public for the check, loopback for anything after.
    let queries = 0;
    const resolve = vi.fn(async () => (queries++ === 0 ? [PUBLIC_ADDRESS] : ["127.0.0.1"]));
    const transport = vi.fn<DispatchTransport>(async () => new Response("ok", { status: 200 }));

    await dispatchOutboundWebhook(
      { url: "https://rebind.example.test/hook", payload: { event: "ping" } },
      { config: config(), resolve, fetchImpl: transport },
    );

    expect(resolve).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledOnce();
    const target = transport.mock.calls[0][2];
    expect(target.addresses).toEqual([PUBLIC_ADDRESS]);
    expect(target.url.hostname).toBe("rebind.example.test");
  });

  it("never opens a connection when any answer is internal", async () => {
    const transport = vi.fn<DispatchTransport>();

    await expect(
      dispatchOutboundWebhook(
        { url: "https://rebind.example.test/hook", payload: {} },
        {
          config: config(),
          resolve: async () => [PUBLIC_ADDRESS, "169.254.169.254"],
          fetchImpl: transport,
        },
      ),
    ).rejects.toBeInstanceOf(OutboundDestinationError);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("pinnedTransport", () => {
  it("delivers to the pinned address without resolving the hostname", async () => {
    const { port, received } = await startServer();
    const url = `http://hooks.example.test:${port}/deliver?token=abc`;

    const response = await pinnedTransport(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Custom": "1" },
        body: '{"event":"ping","note":"café"}',
      },
      loopbackTarget(url),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("accepted");
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("POST");
    expect(received[0].url).toBe("/deliver?token=abc");
    // The receiver sees the hostname it was configured with, not the address.
    expect(received[0].headers.host).toBe(`hooks.example.test:${port}`);
    expect(received[0].headers["x-custom"]).toBe("1");
    expect(received[0].body).toBe('{"event":"ping","note":"café"}');
    expect(received[0].headers["content-length"]).toBe(
      String(Buffer.byteLength('{"event":"ping","note":"café"}')),
    );
  });

  it("does not follow a redirect", async () => {
    const { port, received } = await startServer((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    const url = `http://hooks.example.test:${port}/hook`;

    const response = await pinnedTransport(
      url,
      { method: "POST", body: "{}" },
      loopbackTarget(url),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://169.254.169.254/latest/meta-data/");
    expect(received).toHaveLength(1);
  });

  it("returns a body-less response for 204", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const url = `http://hooks.example.test:${port}/hook`;

    const response = await pinnedTransport(
      url,
      { method: "POST", body: "{}" },
      loopbackTarget(url),
    );
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("aborts on the caller's deadline", async () => {
    const { port } = await startServer(() => {
      // Accept the request and never answer.
    });
    const url = `http://hooks.example.test:${port}/hook`;

    const error = await pinnedTransport(
      url,
      { method: "POST", body: "{}", signal: AbortSignal.timeout(100) },
      loopbackTarget(url),
    ).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(["AbortError", "TimeoutError"]).toContain(error.name);
  });

  it("cannot reach a server that is not at the pinned address", async () => {
    const { port, received } = await startServer();
    const url = `http://hooks.example.test:${port}/hook`;

    // Pinned to a different loopback address than the one the server bound.
    const error = await pinnedTransport(
      url,
      { method: "POST", body: "{}", signal: AbortSignal.timeout(2_000) },
      { url: new URL(url), addresses: ["127.0.0.2"] },
    ).catch((err) => err);

    expect(error).toBeInstanceOf(Error);
    expect(received).toHaveLength(0);
  });
});

describe("dispatchOutboundWebhook through the pinned transport", () => {
  it("delivers a signed webhook to a host that validated as public", async () => {
    const { port, received } = await startServer();
    const url = `http://hooks.example.test:${port}/deliver`;

    // Validation sees a public answer. The real transport then connects to the
    // loopback test server, because no test can listen on a public address.
    const result = await dispatchOutboundWebhook(
      { url, payload: { event: "scan.completed", id: 7 }, secret: "s3cret" },
      {
        config: config(),
        resolve: async () => [PUBLIC_ADDRESS],
        fetchImpl: (requestUrl, init, target) => {
          expect(target.addresses).toEqual([PUBLIC_ADDRESS]);
          return pinnedTransport(requestUrl, init, { ...target, addresses: ["127.0.0.1"] });
        },
        deliveryId: "delivery-1",
      },
    );

    expect(result.status).toBe(200);
    expect(result.bodyPreview).toBe("accepted");
    expect(received).toHaveLength(1);

    const [request] = received;
    expect(request.headers.host).toBe(`hooks.example.test:${port}`);
    expect(request.body).toBe(JSON.stringify({ event: "scan.completed", id: 7 }));
    expect(
      verifySignatureHeader(
        request.headers[SIGNATURE_HEADER.toLowerCase()] as string,
        "s3cret",
        request.body,
      ),
    ).toBe(true);
  });

  it("reports a redirect from the receiver as a permanent failure", async () => {
    const { port, received } = await startServer((_req, res) => {
      res.writeHead(307, { Location: "http://127.0.0.1:6379/" });
      res.end();
    });
    const url = `http://hooks.example.test:${port}/deliver`;

    const error = await dispatchOutboundWebhook(
      { url, payload: {} },
      {
        config: config(),
        resolve: async () => [PUBLIC_ADDRESS],
        fetchImpl: (requestUrl, init, target) =>
          pinnedTransport(requestUrl, init, { ...target, addresses: ["127.0.0.1"] }),
      },
    ).catch((err) => err);

    expect(error).toBeInstanceOf(OutboundDeliveryError);
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(307);
    expect(received).toHaveLength(1);
  });
});

function opensslAvailable(): boolean {
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "openssl-test-"));
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          path.join(dir, "key.pem"),
          "-out",
          path.join(dir, "cert.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=hooks.example.test",
        ],
        { stdio: "ignore" },
      );
      return true;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return false;
  }
}

describe.skipIf(!opensslAvailable())("pinnedTransport over TLS", () => {
  it("sends the hostname as SNI and still verifies the certificate", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pinned-tls-"));
    try {
      const keyPath = path.join(dir, "key.pem");
      const certPath = path.join(dir, "cert.pem");
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "ec",
          "-pkeyopt",
          "ec_paramgen_curve:prime256v1",
          "-nodes",
          "-keyout",
          keyPath,
          "-out",
          certPath,
          "-days",
          "1",
          "-subj",
          "/CN=hooks.example.test",
          "-addext",
          "subjectAltName=DNS:hooks.example.test",
        ],
        { stdio: "ignore" },
      );

      const serverNames: string[] = [];
      const server = https.createServer({
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
        SNICallback: (servername, callback) => {
          serverNames.push(servername);
          callback(null);
        },
      });
      const { port, received } = await startServer(undefined, server);
      const url = `https://hooks.example.test:${port}/hook`;

      const error = await pinnedTransport(
        url,
        { method: "POST", body: "{}", signal: AbortSignal.timeout(5_000) },
        loopbackTarget(url),
      ).catch((err) => err);

      // The certificate names the right host but no trusted CA issued it.
      // Rejecting it proves pinning did not switch verification off. (OpenSSL
      // versions disagree on which chain error a self-signed leaf gets.)
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toMatch(
        /SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER/,
      );
      expect(serverNames).toEqual(["hooks.example.test"]);
      expect(received).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
