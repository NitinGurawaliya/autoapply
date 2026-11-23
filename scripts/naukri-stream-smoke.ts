// K8 (docs/naukri/TASKS.md#k8): the streamed Naukri sign-in, end to end on this machine.
//
// npx tsx scripts/naukri-stream-smoke.ts
//   The worker's relay on a free local port, direct egress (SIGNED_IN_PROXY_URL=off), a local page standing in for
//   Naukri's login. A throwaway user connects: the web app's pass (streamTicket), the phone opens the stream, sees the
//   page in frames sized to a phone, taps the fields and types a made-up user, password and OTP, presses Enter; the
//   worker sees the window signed in and saves it sealed, as K1 does. Then: every way in without the right pass is
//   refused, a cancel and an expiry end the stream, a test profile gets no pass, and nothing typed or shown on the
//   login page reaches this process's log, stealthy-browser.log or storage. Then two more users sign in at the same
//   time, each in their own window and stream: neither pass opens the other's stream, each page gets only its own
//   user's typing, each saved sign-in holds only its own session, and each user has their own proxy session name.
//   Opens Chrome windows for a few seconds.
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
  const { unseal } = await import("../src/lib/sealed");
  const { disconnect, getConnection, sessionName, signStreamToken, siteStateKey, startConnect, streamIdOf, streamTicket } = await import("../src/modules/sources");
  type Ticket = Awaited<ReturnType<typeof streamTicket>>;

  const stealthyLog = process.env.STEALTHY_LOG || path.resolve(process.cwd(), "stealthy-browser.log");
  const stealthyFrom = existsSync(stealthyLog) ? statSync(stealthyLog).size : 0;
  const logs = captureLogs();
  const typed = secrets();
  const typedA = secrets();
  const typedB = secrets();
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
  const userA = await makeUser("a", false);
  const userB = await makeUser("b", false);
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

    // 8. Two users sign in at the same time, each in their own window and stream.
    check("two users connect at once", (await startConnect(userA.id, "naukri", fakeEnqueue)).ok && (await startConnect(userB.id, "naukri", fakeEnqueue)).ok);
    const runA = runConnect(userA.id, "naukri", { loginUrl: login.url, waitForSignIn: fakeWaitForSignIn });
    const runB = runConnect(userB.id, "naukri", { loginUrl: login.url, waitForSignIn: fakeWaitForSignIn });
    const [ticketA, ticketB] = await Promise.all([readyTicket(userA.id), readyTicket(userB.id)]);
    if (ticketA.state !== "ready" || ticketB.state !== "ready") {
      check("both passes ready", false, `${ticketA.state}, ${ticketB.state}`);
      await Promise.all([disconnect(userA.id, "naukri"), disconnect(userB.id, "naukri")]);
      await Promise.allSettled([runA, runB]);
      return;
    }
    check("each user has their own stream", ticketA.url !== ticketB.url && streamIdOf(ticketA.url) !== streamIdOf(ticketB.url));
    check("A's pass does not open B's stream", (await raw(ticketB.url, { headers: { Authorization: `Bearer ${ticketA.token}` } })) === 404);
    check("B's pass does not open A's stream", (await raw(ticketA.url, { headers: { Authorization: `Bearer ${ticketB.token}` } })) === 404);
    const phoneA = new Phone(ticketA.url, ticketA.token);
    const phoneB = new Phone(ticketB.url, ticketB.token);
    // B's stream address with A's pass: what A would send to type into B's window.
    const intruder = new Phone(ticketB.url, ticketA.token);
    check("A cannot type into B's window", (await intruder.type("x")) === 404);
    check("both phones open their stream", (await phoneA.open()) === 200 && (await phoneB.open()) === 200);
    check("both get frames", (await phoneA.until(() => phoneA.frames > 0, 30_000)) && (await phoneB.until(() => phoneB.frames > 0, 30_000)), `${phoneA.frames}, ${phoneB.frames}`);
    // Typed in turns, A and B interleaved, as two people at once would.
    const signIn = (phone: Phone, values: { user: string; pass: string; otp: string }) => [
      () => phone.input([{ t: "tap", ...FIELD.user }]),
      () => phone.type(values.user),
      () => phone.input([{ t: "tap", ...FIELD.pass }]),
      () => phone.type(values.pass),
      () => phone.input([{ t: "tap", ...FIELD.otp }]),
      () => phone.type(values.otp),
      () => phone.input([{ t: "key", k: "Enter" }]),
    ];
    const stepsA = signIn(phoneA, typedA);
    const stepsB = signIn(phoneB, typedB);
    const statusesAB: number[] = [];
    for (let index = 0; index < stepsA.length; index += 1) statusesAB.push(...(await Promise.all([stepsA[index](), stepsB[index]()])));
    check("both users' input accepted", statusesAB.every((status) => status === 204), statusesAB.join(","));
    const [outcomeA, outcomeB] = await Promise.all([runA, runB]);
    check("both connected", outcomeA === "connected" && outcomeB === "connected", `${outcomeA}, ${outcomeB}`);
    const gotA = login.received(typedA.user);
    const gotB = login.received(typedB.user);
    check("A's page got exactly A's typing", gotA?.p === typedA.pass && gotA.o === typedA.otp);
    check("B's page got exactly B's typing", gotB?.p === typedB.pass && gotB.o === typedB.otp);
    await Promise.all([phoneA.close(), phoneB.close()]);
    const saved = async (userId: string, otherId: string) => {
      const key = siteStateKey(userId, "naukri");
      const blob = await storage.get(key);
      const plain = blob ? unseal(blob.bytes, key) : null;
      const state = plain ? (JSON.parse(Buffer.from(plain).toString("utf8")) as { cookies: Array<{ name: string; value: string }> }) : null;
      return {
        marker: state?.cookies.find((cookie) => cookie.name === "k8-marker")?.value ?? null,
        opensAsOther: blob ? unseal(blob.bytes, siteStateKey(otherId, "naukri")) !== null : null,
      };
    };
    const [savedA, savedB] = await Promise.all([saved(userA.id, userB.id), saved(userB.id, userA.id)]);
    check("A's saved sign-in is A's own session", Boolean(gotA) && savedA.marker === gotA!.sid, `${savedA.marker} vs ${gotA?.sid}`);
    check("B's saved sign-in is B's own session", Boolean(gotB) && savedB.marker === gotB!.sid, `${savedB.marker} vs ${gotB?.sid}`);
    check("neither saved sign-in opens as the other user's", savedA.opensAsOther === false && savedB.opensAsOther === false);
    const [rowA, rowB] = await Promise.all([getConnection(userA.id, "naukri"), getConnection(userB.id, "naukri")]);
    check("both show Connected, streams closed", rowA?.status === "connected" && rowB?.status === "connected" && rowA.streamUrl === null && rowB.streamUrl === null);
    check("each user gets their own proxy session", sessionName(userA.id, "naukri") !== sessionName(userB.id, "naukri"));
  } finally {
    logs.stop();
    // 8. Nothing of the login pages in the log, stealthy-browser.log or storage.
    const logged = logs.text();
    const stealthy = existsSync(stealthyLog) ? readFileSync(stealthyLog).subarray(stealthyFrom).toString("utf8") : "";
    const values = [typed, typedA, typedB].flatMap((set) => [set.user, set.pass, set.otp]);
    check("the log has lines from this run", logged.includes("relay: stream opened"));
    check("nothing typed reaches the log", values.every((value) => !logged.includes(value)));
    check("nothing typed reaches stealthy-browser.log", values.every((value) => !stealthy.includes(value)));
    check("no stream token reaches any log", tokens.length > 0 && tokens.every((token) => !logged.includes(token) && !stealthy.includes(token)));
    check("no frame reaches any log", !logged.includes("/9j/") && !stealthy.includes("/9j/"));
    const everyone = [person.id, tester.id, userA.id, userB.id];
    const blobs = await db.fileBlob.findMany({ where: { userId: { in: everyone } }, select: { key: true, bytes: true } });
    check("storage holds only the sealed sign-in", blobs.every((blob) => blob.key.startsWith("browser-state/")), blobs.map((blob) => blob.key).join(","));
    check("nothing typed or seen is in storage", blobs.every((blob) => values.every((value) => !Buffer.from(blob.bytes).includes(Buffer.from(value))) && !Buffer.from(blob.bytes).includes(Buffer.from("/9j/"))));
    check("no screenshot stored", blobs.every((blob) => !/screenshot|\.png|\.jpe?g/i.test(blob.key)));
    const rows = JSON.stringify(await db.siteConnection.findMany({ where: { userId: { in: everyone } } }));
    check("nothing typed is on the connection row", values.every((value) => !rows.includes(value)));

    await stopRelay();
    await login.close();
    await closeAllStealthyBrowsers().catch(() => undefined);
    await db.workerBeat.deleteMany({ where: { id: SMOKE_BEAT } });
    for (const user of [tester, person, userA, userB]) {
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
