// K1 (docs/naukri/TASKS.md#k1): connecting a user's own Naukri account.
//
// npx tsx scripts/naukri-connect-smoke.ts
//   No sign-in needed. Encryption of the saved sign-in, the per-site cookie filter, a test profile refused, the connect
//   and disconnect states, a saved sign-in opened again by a NEW process (a worker restart), Disconnect deleting it.
//   Opens a Chrome window for a few seconds (a signed-in site is only ever used in a visible window). Needs
//   BROWSER_STATE_KEY. Its own throwaway users only; all removed at the end.
//   Then K8: the same connect streamed to a phone (scripts/naukri-stream-smoke.ts, in its own process with its own relay,
//   SIGNED_IN_PROXY_URL=off and a local login page); this smoke passes only when that one does.
//
// npx tsx scripts/naukri-connect-smoke.ts --live you@example.com [--disconnect]
//   The real thing for one account: Naukri's login opens in a Chrome window, YOU sign in there (the script types
//   nothing), the sign-in is saved; then a new process opens Naukri with it and checks it is still signed in.
//   --disconnect deletes it at the end.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { seal, sealKeyReady, unseal } from "../src/lib/sealed";
import { storage } from "../src/lib/storage";
import { onlySite, openBrowser } from "../src/modules/apply/browser";
import { runConnect } from "../src/modules/apply/sites/connect";
import { confirmSignedIn } from "../src/modules/apply/sites/naukri";
import { disconnect, finishConnect, getConnection, SITE_INFO, siteStateKey, startConnect } from "../src/modules/sources";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const SMOKE_BEAT = "naukri-connect-smoke";
const MARKER = "smoke-marker";

/** Runs this script in a fresh process: a worker restart, as far as the saved sign-in is concerned. */
function inNewProcess(args: string[]) {
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  return execFileSync(process.execPath, [cli, __filename, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 180_000 })  // The child's report is its last JSON line: the stealthy Chrome logs its closing after it.
    .trim().split("\n").filter((line) => line.startsWith("{")).at(-1) ?? "";
}

/** K8's streamed connect, end to end, in its own process (it sets up its own relay and environment). */
function streamedConnect() {
  const cli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  try {
    return execFileSync(process.execPath, [cli, join(__dirname, "naukri-stream-smoke.ts")], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 400_000 });
  } catch (error) {
    return String((error as { stdout?: string }).stdout ?? "");
  }
}

/** Child mode: open the saved sign-in and report what came back. */
async function child(mode: string, userId: string) {
  const session = await openBrowser(mode === "--restore-live" ? SITE_INFO.naukri.homeUrl : "about:blank", userId, { site: "naukri", persist: false });
  try {
    const cookies = await session.context.cookies("https://www.naukri.com");
    const other = await session.context.cookies("https://boards.greenhouse.io");
    const signedIn = mode === "--restore-live" ? (await confirmSignedIn(session.page)).signedIn : null;
    console.log(JSON.stringify({ restored: session.restored, marker: cookies.some((c) => c.name === MARKER), naukriCookies: cookies.length, otherCookies: other.length, signedIn }));
  } finally {
    await session.close();
  }
}

async function makeUser(label: string, isTest: boolean) {
  const user = await db.user.create({ data: { email: `naukri-smoke-${label}-${Date.now()}@swipeapply.local`, name: `Naukri ${label}` } });
  await db.profile.create({ data: { userId: user.id, isTest, resumeKey: "x", resumeText: "x", fullName: `Naukri ${label}`, email: user.email, skills: [], experience: [], education: [], rawJson: {} } });
  return user;
}

async function offline() {
  check("BROWSER_STATE_KEY is set", sealKeyReady());
  if (!sealKeyReady()) return;

  // 1. Encryption at rest, bound to its storage key.
  const plain = new TextEncoder().encode('{"cookies":[],"origins":[]}');
  const sealed = seal(plain, "browser-state/a/naukri.json");
  check("sealed blob is not the plain text", !Buffer.from(sealed).includes(Buffer.from("cookies")));
  check("opens under its own storage key", Buffer.from(unseal(sealed, "browser-state/a/naukri.json") ?? []).equals(Buffer.from(plain)));
  check("does not open under another user's key", unseal(sealed, "browser-state/b/naukri.json") === null);
  const tampered = new Uint8Array(sealed);
  tampered[tampered.length - 1] ^= 1;
  check("a changed blob does not open", unseal(tampered, "browser-state/a/naukri.json") === null);

  // 2. Only Naukri's own cookies and storage are kept.
  const cookie = (name: string, domain: string) => ({ name, value: "v", domain, path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" as const });
  const filtered = onlySite(
    {
      cookies: [cookie("a", ".naukri.com"), cookie("b", "www.naukri.com"), cookie("c", "boards.greenhouse.io"), cookie("d", "notnaukri.com"), cookie("e", ".google.com")],
      origins: [{ origin: "https://www.naukri.com", localStorage: [] }, { origin: "https://jobs.lever.co", localStorage: [] }],
    },
    "naukri",
  );
  check("cookie filter keeps naukri.com only", filtered.cookies.map((c) => c.name).join(",") === "a,b", filtered.cookies.map((c) => c.name).join(","));
  check("storage filter keeps naukri.com only", filtered.origins.length === 1 && filtered.origins[0].origin === "https://www.naukri.com");

  const tester = await makeUser("test", true);
  const person = await makeUser("real", false);
  const queued: string[] = [];
  const fakeEnqueue = async (userId: string, site: string) => {
    queued.push(`${site}:${userId}`);
    return "job";
  };
  try {
    // 3. A test profile never connects a real site.
    await db.workerBeat.upsert({ where: { id: SMOKE_BEAT }, create: { id: SMOKE_BEAT, beatAt: new Date(), startedAt: new Date(), hasScreen: true }, update: { beatAt: new Date(), hasScreen: true } });
    const refused = await startConnect(tester.id, "naukri", fakeEnqueue);
    check("test profile refused", !refused.ok && refused.reason === "test_profile", JSON.stringify(refused));
    check("test profile left no connection", (await getConnection(tester.id, "naukri")) === null);

    // 4. Connect: connecting, one window at a time.
    const started = await startConnect(person.id, "naukri", fakeEnqueue);
    const row = await getConnection(person.id, "naukri");
    check("connect starts", started.ok && row?.status === "connecting" && queued.length === 1, JSON.stringify(started));
    const again = await startConnect(person.id, "naukri", fakeEnqueue);
    check("a second connect while one is open is refused", !again.ok && again.reason === "already_connecting");

    // 5. Signed in and saved (what runConnect does after the person signs in), then connected.
    const key = siteStateKey(person.id, "naukri");
    const state = { cookies: [cookie(MARKER, ".naukri.com"), cookie("ats", "boards.greenhouse.io")], origins: [] };
    await storage.put(key, seal(new TextEncoder().encode(JSON.stringify(state)), key), "application/octet-stream", person.id);
    check("connected", (await finishConnect(person.id, "naukri", "Smoke")) && (await getConnection(person.id, "naukri"))?.status === "connected");

    // 6. A worker restart keeps it: a new process opens the saved sign-in.
    const restored = JSON.parse(inNewProcess(["--restore", person.id])) as { restored: boolean; marker: boolean; otherCookies: number };
    check("new process restores the Naukri sign-in", restored.restored && restored.marker, JSON.stringify(restored));
    check("no other site's cookies come with it", restored.otherCookies === 0);
    const stored = await storage.get(key);
    check("stored encrypted, not as JSON", Boolean(stored) && stored!.contentType === "application/octet-stream" && !Buffer.from(stored!.bytes).includes(Buffer.from(MARKER)));

    // 7. Disconnect deletes it at once.
    await disconnect(person.id, "naukri");
    const after = await getConnection(person.id, "naukri");
    check("disconnect deletes the saved sign-in", (await storage.get(key)) === null);
    check("disconnected, nothing kept", after?.status === "disconnected" && after.stateKey === null && after.accountLabel === null);
    const fresh = JSON.parse(inNewProcess(["--restore", person.id])) as { restored: boolean };
    check("after disconnect a new window starts signed out", !fresh.restored);

    // 8. Without a worker that can show a window, Connect says so instead of queueing.
    await db.workerBeat.delete({ where: { id: SMOKE_BEAT } });
    const live = await db.workerBeat.count({ where: { hasScreen: true, beatAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } });
    if (live === 0) {
      const noScreen = await startConnect(person.id, "naukri", fakeEnqueue);
      check("no screen worker: refused with the reason", !noScreen.ok && noScreen.reason === "no_screen_worker");
    } else {
      console.log("skip no-screen check: a real worker with a screen is running");
    }

    // 9. K8: the same connect, streamed to a phone through the worker's relay.
    const streamed = streamedConnect();
    const failures = streamed.split("\n").filter((line) => line.startsWith("FAIL "));
    check("streamed sign-in end to end (naukri-stream-smoke)", streamed.includes("PASS naukri-stream-smoke"), failures.join("; ").slice(0, 300));
  } finally {
    await db.workerBeat.deleteMany({ where: { id: SMOKE_BEAT } });
    for (const user of [tester, person]) {
      await storage.deleteForUser(user.id);
      await db.rateEvent.deleteMany({ where: { key: { endsWith: user.id } } });
      await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  }
}

async function liveRun(email: string, drop: boolean) {
  check("BROWSER_STATE_KEY is set", sealKeyReady());
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no user ${email}`);
  await db.workerBeat.upsert({ where: { id: SMOKE_BEAT }, create: { id: SMOKE_BEAT, beatAt: new Date(), startedAt: new Date(), hasScreen: true }, update: { beatAt: new Date(), hasScreen: true } });
  try {
    const started = await startConnect(user.id, "naukri", async () => "live");
    check("connect starts", started.ok, JSON.stringify(started));
    if (!started.ok) return;
    console.log("A Chrome window opens on Naukri's login. Sign in there yourself (10 minutes). This script types nothing.");
    const outcome = await runConnect(user.id, "naukri");
    const row = await getConnection(user.id, "naukri");
    check("connected after you signed in", outcome === "connected" && row?.status === "connected", `${outcome}, ${row?.status}, ${row?.lastError ?? ""}`);
    console.log(`account label: ${row?.accountLabel ?? "(none read)"}`);
    if (outcome !== "connected") return;
    const restored = JSON.parse(inNewProcess(["--restore-live", user.id])) as { restored: boolean; signedIn: boolean; naukriCookies: number; otherCookies: number };
    check("a new process opens Naukri still signed in", restored.restored && restored.signedIn, JSON.stringify(restored));
    check("only Naukri cookies saved", restored.naukriCookies > 0 && restored.otherCookies === 0);
    if (drop) {
      await disconnect(user.id, "naukri");
      check("disconnect deletes the saved sign-in", (await storage.get(siteStateKey(user.id, "naukri"))) === null);
    }
  } finally {
    await db.workerBeat.deleteMany({ where: { id: SMOKE_BEAT } });
  }
}

async function main() {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "--restore" || mode === "--restore-live") return child(mode, arg);
  if (mode === "--live") await liveRun(arg, process.argv.includes("--disconnect"));
  else await offline();
  console.log(failed === 0 ? "PASS naukri-connect-smoke" : `FAIL naukri-connect-smoke (${failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  // The shared Chrome (browser.ts) keeps the process alive once opened; the script ends here either way.
  .finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
