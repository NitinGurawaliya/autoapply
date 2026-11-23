// K8 (docs/naukri/TASKS.md#k8): the streamed Naukri sign-in, end to end on this machine.
//
// npx tsx scripts/naukri-stream-smoke.ts
//   The worker's relay on a free local port, direct egress (SIGNED_IN_PROXY_URL=off), a local page standing in for
//   Naukri's login. A throwaway user connects: the web app's pass (streamTicket), the phone opens the stream, sees the
//   page in frames sized to a phone, taps the fields and types a made-up user, password and OTP, presses Enter; the
//   worker sees the window signed in and saves it sealed, as K1 does. Then: every way in without the right pass is
//   refused, a cancel and an expiry end the stream, a test profile gets no pass, and nothing typed or shown on the
//   login page reaches this process's log, stealthy-browser.log or storage. Opens a Chrome window for a few seconds.
//   Its own throwaway users only; all removed at the end.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { APP_ORIGIN, captureLogs, FIELD, fakeLogin, fakeWaitForSignIn, Phone, PHONE, relayEnv, secrets } from "./lib/stream-harness";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const SMOKE_BEAT = "naukri-stream-smoke";

async function main() {
  // The relay's settings go in before any module reads them.
  await relayEnv();
  const { db } = await import("../src/lib/db");
  const { storage } = await import("../src/lib/storage");
  const { runConnect } = await import("../src/modules/apply/sites/connect");
  const { openStream, relayReady, startRelay, stopRelay } = await import("../src/modules/apply/sites/relay");
  const { closeAllStealthyBrowsers } = await import("../src/modules/apply/real-browser");
  const { disconnect, getConnection, signStreamToken, siteStateKey, startConnect, streamIdOf, streamTicket } = await import("../src/modules/sources");
  type Ticket = Awaited<ReturnType<typeof streamTicket>>;

  const stealthyLog = process.env.STEALTHY_LOG || path.resolve(process.cwd(), "stealthy-browser.log");
  const stealthyFrom = existsSync(stealthyLog) ? statSync(stealthyLog).size : 0;
  const logs = captureLogs();
  const typed = secrets();
  const tokens: string[] = [];
  const login = await fakeLogin();

  async function makeUser(label: string, isTest: boolean) {
    const user = await db.user.create({ data: { email: `naukri-stream-${label}-${Date.now()}@swipeapply.local`, name: `Stream ${label}` } });
    await db.profile.create({ data: { userId: user.id, isTest, resumeKey: "x", resumeText: "x", fullName: `Stream ${label}`, email: user.email, skills: [], experience: [], education: [], rawJson: {} } });
    return user;
  }
  async function readyTicket(userId: string, ms = 120_000) {
    const deadline = Date.now() + ms;
    let ticket: Ticket = await streamTicket(userId, "naukri");
    while (ticket.state !== "ready" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      ticket = await streamTicket(userId, "naukri");
    }
    if (ticket.state === "ready") tokens.push(ticket.token);
    return ticket;
  }
  const raw = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(url, { ...init, headers: { Origin: APP_ORIGIN, ...init.headers } }).then((r) => r.status);

  const tester = await makeUser("test", true);
  const person = await makeUser("real", false);
  const fakeEnqueue = async () => "job";
  try {
    await startRelay();
    check("relay serves on this worker", relayReady());
    await db.workerBeat.upsert({ where: { id: SMOKE_BEAT }, create: { id: SMOKE_BEAT, beatAt: new Date(), startedAt: new Date(), hasScreen: true }, update: { beatAt: new Date(), hasScreen: true } });

    // 1. A test profile never gets a sign-in, nor a pass to one.
    const refused = await startConnect(tester.id, "naukri", fakeEnqueue);
    check("test profile refused", !refused.ok && refused.reason === "test_profile");
    const testerTicket = await streamTicket(tester.id, "naukri");
    check("test profile gets no stream pass", testerTicket.state === "ended");

    // 2. Connect: the web app's pass waits until the worker has the window open.
    const started = await startConnect(person.id, "naukri", fakeEnqueue);
    check("connect starts", started.ok);
    check("no pass before the window is open", (await streamTicket(person.id, "naukri")).state === "waiting");
    const run = runConnect(person.id, "naukri", { loginUrl: login.url, waitForSignIn: fakeWaitForSignIn });
    const ticket = await readyTicket(person.id);
    check("pass ready once the window is open", ticket.state === "ready", ticket.state);
    if (ticket.state !== "ready") {
      await disconnect(person.id, "naukri");
      await run.catch(() => undefined);
      return;
    }
    const row = await getConnection(person.id, "naukri");
    check("database holds the address, never the token", Boolean(row?.streamUrl) && !row!.streamUrl!.includes(ticket.token) && row!.streamUrl === ticket.url);
    const sid = streamIdOf(ticket.url)!;

    // 3. Every way in without the right pass.
    const exp = Date.now() + 60_000;
    check("no token: refused", (await raw(ticket.url)) === 404);
    check("another origin: refused", (await fetch(ticket.url, { headers: { Authorization: `Bearer ${ticket.token}`, Origin: "https://evil.example" } })).status === 403);
    check("no origin: refused", (await fetch(ticket.url, { headers: { Authorization: `Bearer ${ticket.token}` } })).status === 403);
    check("changed token: refused", (await raw(ticket.url, { headers: { Authorization: `Bearer ${ticket.token.slice(0, -2)}xx` } })) === 404);
    check("another user's token: refused", (await raw(ticket.url, { headers: { Authorization: `Bearer ${signStreamToken({ sid, uid: tester.id, site: "naukri", exp })}` } })) === 404);
    check("expired token: refused", (await raw(ticket.url, { headers: { Authorization: `Bearer ${signStreamToken({ sid, uid: person.id, site: "naukri", exp: Date.now() - 1 })}` } })) === 404);
    const otherSid = ticket.url.replace(sid, "A".repeat(22));
    check("another stream id: refused", (await raw(otherSid, { headers: { Authorization: `Bearer ${signStreamToken({ sid: "A".repeat(22), uid: person.id, site: "naukri", exp })}` } })) === 404);
    const preflight = await fetch(`${ticket.url}/input`, { method: "OPTIONS", headers: { Origin: APP_ORIGIN, "Access-Control-Request-Method": "POST" } });
    check("preflight allows the app only", preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === APP_ORIGIN);

    // 4. The phone sees the page, sized to a phone.
    const phone = new Phone(ticket.url, ticket.token);
    check("phone opens the stream", (await phone.open()) === 200);
    check("frames arrive", await phone.until(() => phone.frames > 0, 30_000), `${phone.frames}`);
    check("frames are JPEG, laid out at the phone's width", Boolean(phone.lastFrame?.d.startsWith("/9j/")) && phone.lastFrame?.w === PHONE.width, `${phone.lastFrame?.w}x${phone.lastFrame?.h}`);

    // 5. Bad input is refused; the person's taps and keys reach the page in order.
    check("an unknown input is refused", (await phone.input([{ t: "eval", s: "x" }])) === 400);
    check("an oversized input is refused", (await phone.input([{ t: "text", s: "x".repeat(20_000) }])) === 400);
    check("input with another user's token is refused", (await phone.input([{ t: "text", s: "x" }], signStreamToken({ sid, uid: tester.id, site: "naukri", exp }))) === 404);
    const statuses = [
      await phone.input([{ t: "scroll", x: 100, y: 100, dy: 40 }, { t: "scroll", x: 100, y: 100, dy: -40 }]),
      await phone.input([{ t: "tap", ...FIELD.user }]),
      await phone.type(typed.user),
      await phone.input([{ t: "tap", ...FIELD.pass }]),
      await phone.type(typed.pass.slice(0, -1) + "Q"),
      await phone.input([{ t: "key", k: "Backspace" }]),
      await phone.type(typed.pass.slice(-1)),
      await phone.input([{ t: "tap", ...FIELD.otp }]),
      await phone.type(typed.otp),
      await phone.input([{ t: "key", k: "Enter" }]),
    ];
    check("taps, keys and text accepted", statuses.every((status) => status === 204), statuses.join(","));
    const outcome = await run;
    check("signed in through the stream: connected", outcome === "connected", String(outcome));
    const received = login.received();
    check("what the person typed reached the page intact (Backspace too)", received?.u === typed.user && received.p === typed.pass && received.o === typed.otp);
    check("the phone is told it connected", await phone.until(() => phone.endOutcome === "connected", 5000), String(phone.endOutcome));
    await phone.close();
    const after = await getConnection(person.id, "naukri");
    check("Connected as the account's name", after?.status === "connected" && after.accountLabel === "Smoke");
    check("stream address cleared", after?.streamUrl === null);
    const done = await streamTicket(person.id, "naukri");
    check("no pass after the window closed", done.state === "ended" && done.status === "connected");
    check("the stream is gone", (await raw(ticket.url, { headers: { Authorization: `Bearer ${ticket.token}` } })) === 404);
    const sealed = await storage.get(siteStateKey(person.id, "naukri"));
    check("sign-in saved sealed (K1)", Boolean(sealed) && sealed!.contentType === "application/octet-stream" && !Buffer.from(sealed!.bytes).includes(Buffer.from("k8-marker")));

    // 6. Cancel while signing in: the window closes, the phone is told, the address goes.
    await startConnect(person.id, "naukri", fakeEnqueue);
    const second = runConnect(person.id, "naukri", { loginUrl: login.url, waitForSignIn: fakeWaitForSignIn });
    const ticket2 = await readyTicket(person.id);
    const phone2 = ticket2.state === "ready" ? new Phone(ticket2.url, ticket2.token) : null;
    if (phone2) await phone2.open();
    await disconnect(person.id, "naukri");
    const cancelled = await second;
    check("Disconnect while signing in cancels", cancelled === "cancelled", String(cancelled));
    check("the phone is told it was cancelled", Boolean(phone2) && (await phone2!.until(() => phone2!.endOutcome === "cancelled", 5000)), String(phone2?.endOutcome));
    await phone2?.close();
    check("stream address cleared after cancel", (await getConnection(person.id, "naukri"))?.streamUrl === null);

    // 7. A stream expires with its connect job's deadline.
    const stub = { watch: () => () => undefined, resize: async () => undefined, input: async () => true, stop: async () => undefined } as never;
    const short = openStream(person.id, "naukri", stub, Date.now() + 1500);
    const shortToken = signStreamToken({ sid: short.sid, uid: person.id, site: "naukri", exp: Date.now() + 60_000 });
    const phone3 = new Phone(short.url, shortToken);
    check("short stream opens", (await phone3.open()) === 200);
    check("it ends as expired at its deadline", await phone3.until(() => phone3.endOutcome === "expired", 5000), String(phone3.endOutcome));
    await phone3.close();
    check("an expired stream refuses the pass", (await raw(short.url, { headers: { Authorization: `Bearer ${shortToken}` } })) === 404);
  } finally {
    logs.stop();
    // 8. Nothing of the login pages in the log, stealthy-browser.log or storage.
    const logged = logs.text();
    const stealthy = existsSync(stealthyLog) ? readFileSync(stealthyLog).subarray(stealthyFrom).toString("utf8") : "";
    const values = [typed.user, typed.pass, typed.otp];
    check("the log has lines from this run", logged.includes("relay: stream opened"));
    check("nothing typed reaches the log", values.every((value) => !logged.includes(value)));
    check("nothing typed reaches stealthy-browser.log", values.every((value) => !stealthy.includes(value)));
    check("no stream token reaches any log", tokens.length > 0 && tokens.every((token) => !logged.includes(token) && !stealthy.includes(token)));
    check("no frame reaches any log", !logged.includes("/9j/") && !stealthy.includes("/9j/"));
    const blobs = await db.fileBlob.findMany({ where: { userId: { in: [person.id, tester.id] } }, select: { key: true, bytes: true } });
    check("storage holds only the sealed sign-in", blobs.every((blob) => blob.key.startsWith("browser-state/")), blobs.map((blob) => blob.key).join(","));
    check("nothing typed or seen is in storage", blobs.every((blob) => values.every((value) => !Buffer.from(blob.bytes).includes(Buffer.from(value))) && !Buffer.from(blob.bytes).includes(Buffer.from("/9j/"))));
    check("no screenshot stored", blobs.every((blob) => !/screenshot|\.png|\.jpe?g/i.test(blob.key)));
    const rows = JSON.stringify(await db.siteConnection.findMany({ where: { userId: { in: [person.id, tester.id] } } }));
    check("nothing typed is on the connection row", values.every((value) => !rows.includes(value)));

    await stopRelay();
    await login.close();
    await closeAllStealthyBrowsers().catch(() => undefined);
    await db.workerBeat.deleteMany({ where: { id: SMOKE_BEAT } });
    for (const user of [tester, person]) {
      await db.$executeRaw`UPDATE pgboss.job SET state = 'cancelled', completed_on = now() WHERE state IN ('created', 'retry') AND data->>'userId' = ${user.id}`.catch(() => 0);
      await storage.deleteForUser(user.id);
      await db.rateEvent.deleteMany({ where: { key: { endsWith: user.id } } });
      await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
    await db.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    failed += 1;
  })
  .finally(() => {
    console.log(failed === 0 ? "PASS naukri-stream-smoke" : `FAIL naukri-stream-smoke (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
  });
