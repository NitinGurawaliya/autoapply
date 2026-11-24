// K7 (docs/naukri/TASKS.md#k7): a signed-in site leaves only from the user's own residential proxy.
//
// npx tsx scripts/naukri-egress-test.ts [--stealthy]
//   Offline: egressFor's rules (one session name per user and site, different between users, "off" direct, unset or
//   without {session} refused, the password never in the label). Then a local proxy that asks for a password and
//   answers http://naukri.test/ itself: two users' Naukri windows (browser.ts openBrowser with `site`) reach it, each
//   with its own session name; a run with no proxy set opens no window. Playwright's browser by default; --stealthy
//   runs the same through the stealthy Chrome (SeleniumBase's proxy, a visible window). Needs a screen.
import { createServer, type IncomingMessage } from "node:http";
import { type AddressInfo } from "node:net";

const STEALTHY = process.argv.includes("--stealthy");
process.env.STEALTHY_BROWSER = STEALTHY ? "1" : "0";
process.env.SIGNED_IN_PROXY_SECRET = "egress-test-secret";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

async function main() {
  const { egressFor, EgressRefused, sessionName } = await import("../src/modules/sources/egress");
  const { openBrowser, canShowWindow } = await import("../src/modules/apply/browser");
  const { NoRetryError } = await import("../src/modules/apply/adapter");

  // Rules, offline.
  const env = { SIGNED_IN_PROXY_SECRET: "k", SIGNED_IN_PROXY_URL: "http://cust-{session}:p%40ss@gate.example.com:7000" };
  const a = egressFor("user-a", "naukri", env)!;
  const a2 = egressFor("user-a", "naukri", env)!;
  const b = egressFor("user-b", "naukri", env)!;
  check("one user keeps one session name", a.username === a2.username && a.username === `cust-${sessionName("user-a", "naukri", env)}`);
  check("two users get two session names", a.username !== b.username);
  check("server, user and password split out", a.server === "http://gate.example.com:7000" && a.password === "p@ss");
  check("SeleniumBase form for an http proxy", a.seleniumProxy === `${a.username}:p@ss@gate.example.com:7000`);
  check("the label carries no password", !a.label.includes("p@ss") && a.label.includes("gate.example.com"));
  check("off: direct (development)", egressFor("user-a", "naukri", { ...env, SIGNED_IN_PROXY_URL: "off" }) === null);
  const refused = (e: Record<string, string>) => {
    try {
      egressFor("user-a", "naukri", e);
      return false;
    } catch (error) {
      return error instanceof EgressRefused;
    }
  };
  check("unset: refused", refused({ SIGNED_IN_PROXY_SECRET: "k" }));
  check("no {session}: refused", refused({ ...env, SIGNED_IN_PROXY_URL: "http://u:p@gate.example.com:7000" }));
  // IPRoyal: exactly 8 letters and digits, in the password, with the city and a 7-day lifetime.
  const royal = { ...env, SIGNED_IN_PROXY_URL: "http://cust:pw_country-in_city-bengaluru_session-{session:8}_lifetime-7d@geo.iproyal.com:12321" };
  const r1 = egressFor("user-a", "naukri", royal);
  const r2 = egressFor("user-b", "naukri", royal);
  const named = /_session-([a-z0-9]+)_lifetime-7d$/.exec(r1?.password ?? "")?.[1] ?? "";
  check("{session:8}: exactly 8 letters and digits, in the password", /^[a-z0-9]{8}$/.test(named), named);
  check("{session:8}: the same user keeps it, another user gets another", egressFor("user-a", "naukri", royal)?.password === r1?.password && r1?.password !== r2?.password);
  check("{session:N} out of range: refused", refused({ ...env, SIGNED_IN_PROXY_URL: "http://u-{session:3}:p@gate.example.com:7000" }));
  check("no port: refused", refused({ ...env, SIGNED_IN_PROXY_URL: "http://u-{session}:p@gate.example.com" }));
  check("no secret: refused", refused({ SIGNED_IN_PROXY_URL: env.SIGNED_IN_PROXY_URL }));

  if (!canShowWindow()) {
    console.log("skip the browser part: no screen here");
    console.log(failed === 0 ? "PASS naukri-egress-test" : `FAIL naukri-egress-test (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
  }

  // A proxy that wants a password, and answers http://naukri.test/ itself with the session name it was reached under.
  const seen: string[] = [];
  const userOf = (request: IncomingMessage) => {
    const header = request.headers["proxy-authorization"];
    if (!header?.startsWith("Basic ")) return null;
    const [user, pass] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
    return pass === "pw" ? user : null;
  };
  const proxy = createServer((request, response) => {
    const user = userOf(request);
    if (!user) {
      response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="egress-test"', "Content-Length": "0" });
      response.end();
      return;
    }
    if (request.url?.startsWith("http://naukri.test/")) seen.push(user);
    const body = `<html><body><p id="via">${user}</p></body></html>`;
    response.writeHead(200, { "Content-Type": "text/html", "Content-Length": Buffer.byteLength(body) });
    response.end(body);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as AddressInfo).port;
  process.env.SIGNED_IN_PROXY_URL = `http://u-{session}:pw@127.0.0.1:${port}`;

  const via = async (userId: string) => {
    const session = await openBrowser("http://naukri.test/", userId, { site: "naukri", fresh: true, persist: false });
    try {
      return (await session.page.locator("#via").textContent({ timeout: 15000 }))?.trim() ?? null;
    } finally {
      await session.close();
    }
  };
  try {
    const shownA = await via("egress-user-a");
    const shownB = await via("egress-user-b");
    const expectA = `u-${sessionName("egress-user-a", "naukri")}`;
    const expectB = `u-${sessionName("egress-user-b", "naukri")}`;
    check(`user A's window went through the proxy as A (${STEALTHY ? "stealthy" : "playwright"})`, shownA === expectA, `got ${shownA}`);
    check("user B's window went through the proxy as B", shownB === expectB, `got ${shownB}`);
    check("the proxy saw both, under their own names", seen.includes(expectA) && seen.includes(expectB), seen.join(","));

    delete process.env.SIGNED_IN_PROXY_URL;
    const before = seen.length;
    let error: unknown = null;
    try {
      await (await openBrowser("http://naukri.test/", "egress-user-a", { site: "naukri", fresh: true, persist: false })).close();
    } catch (caught) {
      error = caught;
    }
    check("no proxy set: refused before any window, nothing sent", error instanceof NoRetryError && seen.length === before, String(error));
  } finally {
    proxy.close();
  }
  console.log(failed === 0 ? "PASS naukri-egress-test" : `FAIL naukri-egress-test (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  console.log("FAIL naukri-egress-test");
  process.exit(1);
});
