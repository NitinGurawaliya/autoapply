import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";

/**
 * A proxy on 127.0.0.1 that adds the user's proxy sign-in and passes everything on (K6, 24 Nov). The stealthy Chrome is
 * given this one, with no password: given the provider's own address with a password, SeleniumBase answers Chrome's
 * sign-in prompts over DevTools only while its own commands run, so a page our Playwright code opens waited for an
 * answer that never came (Naukri's login hung 90 s through IPRoyal, while Playwright's own browser and curl through the
 * same session loaded it). The password stays in this process's memory: never in Chrome's arguments, an extension or a
 * file, never logged.
 *
 * One per window, on a free port, listening on 127.0.0.1 only, closed with the window. HTTP CONNECT tunnels (https
 * sites) and plain http requests; the upstream is an http proxy.
 */

export type ForwarderUpstream = { host: string; port: number; username?: string; password?: string };

/**
 * Chrome's own background services, refused by the forwarder (K15, 25 Nov): a fresh window downloaded Chrome's
 * "optimization guide" models, 13.6 MB of a 14.8 MB Naukri search page through the paid proxy (Naukri itself: about
 * 1 MB). None of it is a site's page; refusing it here changes nothing Chrome shows a site. Not refused: Google's
 * reCAPTCHA and sign-in (www.google.com, www.gstatic.com, accounts.google.com).
 */
export const CHROME_BACKGROUND = /^(optimizationguide-pa|update|safebrowsing|content-autofill|clientservices|chromewebstore|chromereporting-pa|edgedl\.me\.gvt1|redirector\.gvt1|[a-z0-9-]+\.gvt1)\.(googleapis\.com|com)$|^clients[0-9]*\.google\.com$|^android\.clients\.google\.com$|(^|\.)gvt[12]\.com$/i;
/** `bytes`: what went to and came from the provider so far, the traffic it bills (counts only). */
export type Forwarder = { port: number; bytes: () => { up: number; down: number }; byHost: () => Map<string, number>; close: () => Promise<void> };

const HEADER_LIMIT = 16 * 1024;

export async function startForwarder(upstream: ForwarderUpstream, refuse: RegExp | null = CHROME_BACKGROUND): Promise<Forwarder> {
  const auth = upstream.username ? `Basic ${Buffer.from(`${upstream.username}:${upstream.password ?? ""}`).toString("base64")}` : null;
  const sockets = new Set<Socket>();
  // Bytes to and from the upstream: open sockets are read when asked, closed ones are added up as they close.
  const counted = { up: 0, down: 0 };
  const upstreamSockets = new Set<Socket>();
  // Bytes by destination host (host names only), to see where a window's traffic goes.
  const hosts = new Map<string, number>();
  const track = (socket: Socket, host = "http") => {
    upstreamSockets.add(socket);
    socket.once("close", () => {
      counted.up += socket.bytesWritten;
      counted.down += socket.bytesRead;
      hosts.set(host, (hosts.get(host) ?? 0) + socket.bytesRead + socket.bytesWritten);
      upstreamSockets.delete(socket);
    });
  };
  const refused = (host: string) => Boolean(refuse?.test(host));
  const server: Server = createServer((req, res) => {
    // Plain http: the request goes to the upstream proxy as is (absolute address), with the sign-in added.
    let plainHost = "";
    try {
      plainHost = new URL(req.url ?? "").hostname;
    } catch {
      plainHost = "";
    }
    if (refused(plainHost)) {
      hosts.set(`refused ${plainHost}`, (hosts.get(`refused ${plainHost}`) ?? 0) + 1);
      res.writeHead(403).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    if (auth) headers["proxy-authorization"] = auth;
    const forwarded = httpRequest({ host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers, agent: false }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    forwarded.on("socket", track);
    forwarded.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(forwarded);
  });

  server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    const target = req.url ?? "";
    if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(target)) {
      client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    if (refused(target.replace(/:\d+$/, ""))) {
      const name = `refused ${target.replace(/:\d+$/, "")}`;
      hosts.set(name, (hosts.get(name) ?? 0) + 1);
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const outbound = connect(upstream.port, upstream.host);
    sockets.add(outbound);
    track(outbound, target.replace(/:\d+$/, ""));
    outbound.on("close", () => sockets.delete(outbound));
    const fail = () => {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      outbound.destroy();
    };
    outbound.once("error", fail);
    client.on("error", () => outbound.destroy());
    outbound.once("connect", () => {
      outbound.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ""}\r\n`);
    });
    // Read the upstream's answer to CONNECT; on 200 the tunnel is open and the two sides are joined.
    let answer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      answer = Buffer.concat([answer, chunk]);
      const end = answer.indexOf("\r\n\r\n");
      if (end < 0) {
        if (answer.length > HEADER_LIMIT) fail();
        return;
      }
      outbound.off("data", onData);
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(answer.subarray(0, end).toString("latin1"))?.[1];
      if (status !== "200") {
        client.end(`HTTP/1.1 ${status ?? "502"} Upstream Refused\r\n\r\n`);
        outbound.destroy();
        return;
      }
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const rest = answer.subarray(end + 4);
      if (rest.length) client.write(rest);
      if (head.length) outbound.write(head);
      outbound.pipe(client);
      client.pipe(outbound);
    };
    outbound.on("data", onData);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    byHost: () => new Map(hosts),
    bytes: () => {
      let up = counted.up;
      let down = counted.down;
      for (const socket of upstreamSockets) {
        up += socket.bytesWritten;
        down += socket.bytesRead;
      }
      return { up, down };
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
