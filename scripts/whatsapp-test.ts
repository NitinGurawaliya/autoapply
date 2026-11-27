// Phase Y, Y2 (docs/whatsapp/TASKS.md#y2): receive, send, link. Offline: no database, no network, no Meta credentials.
// The webhook signature, the parsing of recorded payloads, the duplicate wamid, the link code (claimed once, expired,
// another user's, a test profile), the stranger reply and the Graph client against a stubbed fetch.
// npx tsx scripts/whatsapp-test.ts
process.env.WHATSAPP_ENABLED = "1";
process.env.WHATSAPP_APP_SECRET = "test-app-secret-not-real";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token-not-real";
process.env.WHATSAPP_NUMBER_E164 = "+15550001111";
process.env.WHATSAPP_TEST_NUMBERS = "+91 90000 00001, 919000000002";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token-not-real";
process.env.WHATSAPP_PHONE_NUMBER_ID = "100200300";
process.env.APP_URL = "https://app.example.test";

import { createClient, classifyError, WhatsAppSendError } from "../src/modules/whatsapp/client";
import { copy } from "../src/modules/whatsapp/copy";
import { handleInbound } from "../src/modules/whatsapp/inbound";
import { claimLink, createLinkCode, makeCode, parseJoin, unlink } from "../src/modules/whatsapp/link";
import { maskPhone, normalizePhone, phoneKey, readPlan, readState, whatsappEnabled } from "../src/modules/whatsapp/state";
import type { CodeRow, LinkRow, MessageRow, Store } from "../src/modules/whatsapp/store";
import { parseEvents, processWebhook, sign, verifyChallenge, verifySignature, type InboundJob } from "../src/modules/whatsapp/webhook";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean, detail = "") {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

/** The Store in memory, with the same one-step rules the SQL has (a unique wamid, a code spent once). */
function memoryStore() {
  const messages = new Map<string, MessageRow & { status?: string; error?: string | null; createdAt: Date }>();
  const codes = new Map<string, CodeRow>();
  const links = new Map<string, LinkRow>();
  const testUsers = new Set<string>();
  const users = new Set<string>();
  const store: Store = {
    async insertMessage(row) {
      if (messages.has(row.wamid)) return false;
      messages.set(row.wamid, { ...row, createdAt: new Date() });
      return true;
    },
    async applyStatus(wamid, status, error) {
      const row = messages.get(wamid);
      if (row && row.direction === "out") Object.assign(row, { status, error });
    },
    async pruneStrangerMessages(now) {
      let removed = 0;
      for (const [id, row] of messages) {
        if (row.userId !== null || row.createdAt.getTime() >= now.getTime() - 24 * 3600_000) continue;
        messages.delete(id);
        removed += 1;
      }
      return removed;
    },
    async saveCode(row) {
      if (codes.has(row.code)) throw new Error("duplicate code");
      codes.set(row.code, { ...row, usedAt: null });
    },
    async findCode(code) {
      return codes.get(code) ?? null;
    },
    async consumeCode(code, now) {
      const row = codes.get(code);
      if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return false;
      row.usedAt = now;
      return true;
    },
    async deleteStaleCodes(userId, now) {
      for (const [code, row] of codes) if ((row.userId === userId && !row.usedAt) || row.expiresAt.getTime() < now.getTime() - 3600_000) codes.delete(code);
    },
    async findLinkByPhone(phone) {
      return [...links.values()].find((link) => link.phone === phone) ?? null;
    },
    async findLinkByUser(userId) {
      return links.get(userId) ?? null;
    },
    async userIsTest(userId) {
      return users.has(userId) ? testUsers.has(userId) : null;
    },
    async upsertLink(userId, phone, now) {
      links.set(userId, { userId, phone, linkedAt: now, optedOutAt: null, pausedUntil: null, timezone: "Asia/Kolkata", morningAt: "08:30", dropsPerDay: 2, lastInboundAt: now });
    },
    async deleteLink(userId) {
      links.delete(userId);
    },
    async touchInbound(userId, now) {
      const link = links.get(userId);
      if (link) link.lastInboundAt = now;
    },
    async touchOutbound() {},
  };
  return { store, messages, codes, links, addUser: (id: string, isTest = false) => (users.add(id), isTest && testUsers.add(id)) };
}

/** A recorded text message as Meta sends it. */
const metaBody = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550001111", phone_number_id: "100200300" }, ...value } }] }] });
const textPayload = (id: string, from: string, body: string) => metaBody({ contacts: [{ profile: { name: "A" }, wa_id: from }], messages: [{ from, id, timestamp: "1764576000", type: "text", text: { body } }] });

async function main() {
  // ---- the switch and the number helpers
  check("the flag is on in this test", whatsappEnabled());
  delete process.env.WHATSAPP_ENABLED;
  check("the flag is off unless WHATSAPP_ENABLED=1", !whatsappEnabled());
  process.env.WHATSAPP_ENABLED = "1";
  check("phone normalised to E.164", normalizePhone("+91 98765-43210") === "+919876543210" && normalizePhone("919876543210") === "+919876543210");
  check("a short or non-numeric phone is refused", normalizePhone("12345") === null && normalizePhone("abc") === null && normalizePhone(null) === null);
  const masked = maskPhone("+919876543210");
  check("the number is shown masked, last three digits only", masked === "+91 ••••• ••210" && !masked.includes("9876"), masked);
  check("the phone key is not the number and is stable", phoneKey("+919876543210") === phoneKey("+919876543210") && !phoneKey("+919876543210").includes("9876543210") && phoneKey("+919876543210") !== phoneKey("+919876543211"));
  check("a stored state that does not fit reads as null", readState({ mode: "weird" }) === null && readState(null) === null && readState({ mode: "idle", updatedAt: new Date().toISOString() })?.mode === "idle");
  check("a stored plan reads through the schema", readPlan({ day: "2026-12-01", morning: new Date().toISOString(), drops: [], sentMorning: false, sentDrops: 0 }) !== null && readPlan({ day: 1 }) === null);

  // ---- the signature
  const raw = JSON.stringify(textPayload("wamid.AAA", "919876543210", "hello"));
  const good = sign(raw, process.env.WHATSAPP_APP_SECRET!);
  check("signature: good", verifySignature(raw, good));
  check("signature: a tampered body is refused", !verifySignature(raw.replace("hello", "hellp"), good));
  check("signature: a wrong secret is refused", !verifySignature(raw, sign(raw, "another-secret")));
  check("signature: no header, a bare hex and a short header are refused", !verifySignature(raw, null) && !verifySignature(raw, good.slice("sha256=".length)) && !verifySignature(raw, "sha256=abc"));
  const savedSecret = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  check("signature: no app secret set refuses everything", !verifySignature(raw, good));
  process.env.WHATSAPP_APP_SECRET = savedSecret;
  check("challenge: the right token echoes the challenge", verifyChallenge({ mode: "subscribe", token: "test-verify-token-not-real", challenge: "12345" }) === "12345");
  check("challenge: a wrong token, wrong mode or missing parts are refused", verifyChallenge({ mode: "subscribe", token: "nope", challenge: "1" }) === null && verifyChallenge({ mode: "unsubscribe", token: "test-verify-token-not-real", challenge: "1" }) === null && verifyChallenge({ mode: "subscribe", token: null, challenge: "1" }) === null);

  // ---- parsing recorded payloads
  const text = parseEvents(textPayload("wamid.T1", "919876543210", "Join K7Q4M9XA"));
  check("parse: a text message", text.messages.length === 1 && text.messages[0].kind === "text" && text.messages[0].text === "Join K7Q4M9XA" && text.messages[0].from === "+919876543210" && text.messages[0].wamid === "wamid.T1" && text.messages[0].timestamp === 1764576000);
  const button = parseEvents(metaBody({ messages: [{ from: "919876543210", id: "wamid.B1", timestamp: "1764576001", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "apply:job_1", title: "Apply" } } }] }));
  check("parse: a button reply", button.messages[0]?.kind === "button" && button.messages[0].payload === "apply:job_1" && button.messages[0].text === "Apply");
  const quick = parseEvents(metaBody({ messages: [{ from: "919876543210", id: "wamid.B2", timestamp: "1764576002", type: "button", button: { payload: "show_me", text: "Show me" } }] }));
  check("parse: a template quick-reply tap", quick.messages[0]?.kind === "button" && quick.messages[0].payload === "show_me");
  const list = parseEvents(metaBody({ messages: [{ from: "919876543210", id: "wamid.L1", timestamp: "1764576003", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "opt_3", title: "Platform", description: "x" } } }] }));
  check("parse: a list reply", list.messages[0]?.kind === "list" && list.messages[0].payload === "opt_3" && list.messages[0].text === "Platform");
  const flow = parseEvents(metaBody({ messages: [{ from: "919876543210", id: "wamid.F1", timestamp: "1764576004", type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { response_json: "{}" } } }] }));
  check("parse: a flow completion", flow.messages[0]?.kind === "flow");
  const doc = parseEvents(metaBody({ messages: [{ from: "919876543210", id: "wamid.D1", timestamp: "1764576005", type: "document", document: { id: "m1" } }, { from: "919876543210", id: "wamid.I1", timestamp: "1764576006", type: "image" }] }));
  check("parse: a document and an unknown type", doc.messages[0]?.kind === "document" && doc.messages[1]?.kind === "other");
  const status = parseEvents(metaBody({ statuses: [{ id: "wamid.O1", status: "delivered", timestamp: "1764576010", recipient_id: "919876543210" }, { id: "wamid.O2", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] }, { id: "wamid.O3", status: "deleted" }] }));
  check("parse: statuses, a failure with its code, an unknown status skipped", status.statuses.length === 2 && status.statuses[0].status === "delivered" && status.statuses[1].errorCode === "131047" && status.messages.length === 0);
  check("parse: nonsense gives nothing and does not throw", parseEvents(null).messages.length === 0 && parseEvents({ entry: "x" }).messages.length === 0 && parseEvents({ entry: [{ changes: [{ value: { messages: [{ id: 5 }, null] } }] }] }).messages.length === 0);

  // ---- the webhook: signature, one row per wamid, one job per new message
  {
    const memory = memoryStore();
    const queued: InboundJob[] = [];
    const warns: string[] = [];
    const deps = { store: memory.store, enqueue: async (job: InboundJob) => void queued.push(job), warn: (what: string) => void warns.push(what) };
    const body = JSON.stringify(textPayload("wamid.DUP", "919876543210", "Join K7Q4M9XA"));
    check("webhook: a tampered body is 403 and nothing is stored", (await processWebhook(body.replace("Join", "Jion"), sign(body, process.env.WHATSAPP_APP_SECRET!), deps)) === 403 && memory.messages.size === 0 && queued.length === 0);
    check("webhook: no signature is 403", (await processWebhook(body, null, deps)) === 403);
    check("webhook: a good signature is 200, stored and enqueued", (await processWebhook(body, sign(body, process.env.WHATSAPP_APP_SECRET!), deps)) === 200 && memory.messages.size === 1 && queued.length === 1 && queued[0].text === "Join K7Q4M9XA");
    check("webhook: the stored row has no body and no number", (() => { const row = [...memory.messages.values()][0]; return row.kind === "text" && row.direction === "in" && row.userId === null && !JSON.stringify(row).includes("9876543210") && !JSON.stringify(row).includes("K7Q4M9XA"); })());
    check("webhook: the same wamid again is 200, stored once, enqueued once", (await processWebhook(body, sign(body, process.env.WHATSAPP_APP_SECRET!), deps)) === 200 && memory.messages.size === 1 && queued.length === 1);
    await memory.store.insertMessage({ wamid: "wamid.OUT1", userId: null, direction: "out", kind: "text" });
    const statusBody = JSON.stringify(metaBody({ statuses: [{ id: "wamid.OUT1", status: "failed", errors: [{ code: 131047 }] }] }));
    check("webhook: a status updates the outbound row with the code only", (await processWebhook(statusBody, sign(statusBody, process.env.WHATSAPP_APP_SECRET!), deps)) === 200 && memory.messages.get("wamid.OUT1")?.status === "failed" && memory.messages.get("wamid.OUT1")?.error === "131047");
    const junk = "not json at all";
    check("webhook: a signed body that is not JSON is 200 and dropped", (await processWebhook(junk, sign(junk, process.env.WHATSAPP_APP_SECRET!), deps)) === 200 && warns.includes("body_not_json"));
    const broken: typeof deps = { ...deps, store: { ...memory.store, insertMessage: async () => { throw new Error("database down"); } } };
    const body2 = JSON.stringify(textPayload("wamid.X2", "919876543210", "hi"));
    check("webhook: a store failure is still only 200 or 403", (await processWebhook(body2, sign(body2, process.env.WHATSAPP_APP_SECRET!), broken)) === 200 && warns.includes("message_not_handled"));
    check("webhook: no warning carries a number or a text", warns.every((line) => !/\d{8}/.test(line) && !line.includes("Join")));
    delete process.env.WHATSAPP_ENABLED;
    const before = memory.messages.size;
    check("webhook: switched off, a POST is 200 and dropped (even unsigned)", (await processWebhook(body2, null, deps)) === 200 && memory.messages.size === before && queued.length === 1);
    process.env.WHATSAPP_ENABLED = "1";
    const known = memoryStore();
    known.addUser("u1");
    await known.store.upsertLink("u1", "+919876543210", new Date());
    const linkedBody = JSON.stringify(textPayload("wamid.KNOWN", "919876543210", "jobs"));
    await processWebhook(linkedBody, sign(linkedBody, process.env.WHATSAPP_APP_SECRET!), { ...deps, store: known.store });
    check("webhook: a message from a linked number is stored against its user", known.messages.get("wamid.KNOWN")?.userId === "u1");
  }

  // ---- the link code
  {
    const memory = memoryStore();
    memory.addUser("alice");
    memory.addUser("bob");
    memory.addUser("tester", true);
    const now = new Date("2026-12-01T10:00:00Z");
    const made = await createLinkCode("alice", memory.store, now);
    check("code: 8 characters from the 32-letter alphabet", /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(made.code), made.code);
    check("code: valid 15 minutes", made.expiresAt.getTime() - now.getTime() === 15 * 60_000);
    check("code: the wa.me link has Join and the code typed in", made.url === `https://wa.me/15550001111?text=Join%20${made.code}`, String(made.url));
    check("code: a thousand codes are 8 characters and mostly different", (() => { const set = new Set(Array.from({ length: 1000 }, () => makeCode())); return set.size > 995 && [...set].every((c) => c.length === 8); })());
    check("parseJoin: Join, any case and spacing, a full stop", parseJoin("Join K7Q4M9XA") === "K7Q4M9XA" && parseJoin("  join k7q4m9xa. ") === "K7Q4M9XA" && parseJoin("JOIN   K7Q4M9XA") === "K7Q4M9XA");
    check("parseJoin: anything else is not a join", parseJoin("join") === null && parseJoin("Join K7Q4M9X") === null && parseJoin("please join K7Q4M9XA now") === null && parseJoin(undefined) === null);

    const first = await claimLink("+919876543210", made.code, memory.store, new Date(now.getTime() + 60_000));
    check("claim: the owner's code binds the number", first.ok && first.userId === "alice" && memory.links.get("alice")?.phone === "+919876543210");
    const second = await claimLink("+919876543210", made.code, memory.store, new Date(now.getTime() + 90_000));
    check("claim: the same code a second time is refused (used)", !second.ok && second.reason === "code_used");
    const racing = await createLinkCode("alice", memory.store, now);
    const both = await Promise.all([claimLink("+919876543210", racing.code, memory.store, now), claimLink("+919876543210", racing.code, memory.store, now)]);
    check("claim: two messages with one code link at most once", both.filter((result) => result.ok).length === 1);
    const lateCode = await createLinkCode("bob", memory.store, now);
    const late = await claimLink("+919811112222", lateCode.code, memory.store, new Date(now.getTime() + 16 * 60_000));
    check("claim: an expired code is refused", !late.ok && late.reason === "code_expired" && !memory.links.has("bob"));
    const bobCode = await createLinkCode("bob", memory.store, now);
    const foreign = await claimLink("+919876543210", bobCode.code, memory.store, now);
    check("claim: another user's code from a number already linked to someone else is refused", !foreign.ok && foreign.reason === "number_in_use" && !memory.links.has("bob"));
    check("claim: a refused claim does not spend the code", (await memory.store.findCode(bobCode.code))?.usedAt === null);
    const unknown = await claimLink("+919811112222", "ZZZZZZZZ", memory.store, now);
    check("claim: an unknown code is refused", !unknown.ok && unknown.reason === "unknown_code");
    check("claim: a bad number is refused", (await claimLink("12", bobCode.code, memory.store, now)).ok === false);
    const newer = await createLinkCode("bob", memory.store, now);
    check("code: a newer code cancels the earlier unused one", (await memory.store.findCode(bobCode.code)) === null && (await memory.store.findCode(newer.code)) !== null);
    const bobOk = await claimLink("+919811112222", newer.code, memory.store, now);
    check("claim: a different user links a different number", bobOk.ok && memory.links.get("bob")?.phone === "+919811112222");
    const gone = await createLinkCode("ghost", memory.store, now);
    check("claim: a code whose user no longer exists is refused", (await claimLink("+919833334444", gone.code, memory.store, now)).ok === false);

    const testCode = await createLinkCode("tester", memory.store, now);
    const stranger = await claimLink("+919855556666", testCode.code, memory.store, now);
    check("claim: a test profile is refused for a number not in WHATSAPP_TEST_NUMBERS", !stranger.ok && stranger.reason === "test_number" && !memory.links.has("tester"));
    check("claim: that refusal did not spend the code", (await memory.store.findCode(testCode.code))?.usedAt === null);
    const listed = await claimLink("+91 90000 00001", testCode.code, memory.store, now);
    check("claim: a test profile links a listed number (any spelling)", listed.ok && memory.links.get("tester")?.phone === "+919000000001");
    await unlink("alice", memory.store);
    check("unlink: the link row, and the number with it, is gone", !memory.links.has("alice"));
    const spare = await createLinkCode("bob", memory.store, now);
    await unlink("bob", memory.store);
    check("unlink: the user's unused codes are gone too", (await memory.store.findCode(spare.code)) === null && !memory.links.has("bob"));
  }

  // ---- the inbound flow: join, refusal, stranger once a day, a linked user
  {
    const memory = memoryStore();
    memory.addUser("alice");
    const sent: Array<{ to: string; userId: string | null; text: string }> = [];
    const warns: string[] = [];
    const seen = new Map<string, number>();
    const deps = {
      store: memory.store,
      client: { sendText: async (target: { to: string; userId: string | null }, body: string) => (sent.push({ to: target.to, userId: target.userId, text: body }), "wamid.sent") },
      allow: async (key: string, max: number) => ((seen.set(key, (seen.get(key) ?? 0) + 1), (seen.get(key) ?? 0) <= max)),
      now: () => new Date("2026-12-01T10:00:00Z"),
      warn: (what: string) => void warns.push(what),
    };
    const message = (wamid: string, from: string, textBody: string) => ({ wamid, from, kind: "text" as const, text: textBody, timestamp: 1 });
    const stranger = "+919700000001";
    check("stranger: the first message gets the one link line", (await handleInbound(message("w1", stranger, "hello"), deps)) === "stranger_replied" && sent.length === 1 && sent[0].text === copy.stranger() && sent[0].userId === null && sent[0].text.includes("https://app.example.test/account"));
    check("stranger: the second message the same day gets nothing", (await handleInbound(message("w2", stranger, "hello?"), deps)) === "stranger_silent" && sent.length === 1);
    check("stranger: another number gets its own line", (await handleInbound(message("w3", "+919700000002", "hi"), deps)) === "stranger_replied" && sent.length === 2);
    check("stranger: a button tap or a file is treated the same, no job cards", (await handleInbound({ wamid: "w4", from: "+919700000003", kind: "button", payload: "apply:job_1", timestamp: 1 }, deps)) === "stranger_replied" && sent.at(-1)?.text === copy.stranger());
    const made = await createLinkCode("alice", memory.store, deps.now());
    const before = sent.length;
    check("join: a good code links and welcomes with the morning time", (await handleInbound(message("w5", stranger, `Join ${made.code}`), deps)) === "linked" && memory.links.get("alice")?.phone === stranger && sent.length === before + 1 && sent.at(-1)?.text === copy.linked("08:30") && sent.at(-1)?.userId === "alice");
    check("join: the welcome text carries no number", !/d{8}/.test(sent.at(-1)?.text ?? ""));
    check("join: the same code again is refused with one line", (await handleInbound(message("w6", stranger, `Join ${made.code}`), deps)) === "refused" && sent.at(-1)?.text === copy.codeRefused());
    check("join: a wrong code is refused with the same line", (await handleInbound(message("w7", "+919700000009", "Join ABCDEFGH"), deps)) === "refused" && sent.at(-1)?.text === copy.codeRefused());
    for (let attempt = 0; attempt < 6; attempt += 1) await handleInbound(message(`wr${attempt}`, "+919700000010", "Join ABCDEFGH"), deps);
    check("join: refusal replies are limited to 5 a day to one number", sent.filter((line) => line.to === "+919700000010").length === 5);
    const count = sent.length;
    check("linked user: a message opens the window and gets no stranger line", (await handleInbound(message("w8", stranger, "jobs"), deps)) === "linked_user" && sent.length === count && memory.links.get("alice")?.lastInboundAt?.toISOString() === "2026-12-01T10:00:00.000Z");
    check("no warning carries a number or a text", warns.every((line) => !/\d{8}/.test(line)));
    const failing = { ...deps, client: { sendText: async () => { throw new WhatsAppSendError("window_closed", "131047"); } } };
    check("a reply that fails to send is logged by kind and does not throw", (await handleInbound(message("w9", "+919700000020", "hello"), failing)) === "stranger_replied" && warns.includes("reply_not_sent:window_closed") && warns.every((line) => !line.includes("9700000020")));
  }

  // ---- the Graph client against a stubbed fetch
  {
    const memory = memoryStore();
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    let reply: { status: number; json: unknown } = { status: 200, json: { messages: [{ id: "wamid.NEW1" }] } };
    const stub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(reply.json), { status: reply.status });
    }) as typeof fetch;
    const client = createClient({ store: memory.store, fetchImpl: stub, now: () => new Date("2026-12-01T10:00:00Z") });
    const to = { to: "+919876543210", userId: "alice" };
    const wamid = await client.sendText(to, "Linked.");
    check("client: sendText posts to the graph URL with the token and the digits only", wamid === "wamid.NEW1" && calls[0].url === "https://graph.facebook.com/v25.0/100200300/messages" && calls[0].auth === "Bearer test-token-not-real" && calls[0].body.to === "919876543210" && calls[0].body.type === "text" && calls[0].body.messaging_product === "whatsapp");
    check("client: the outbound row records the kind and no text", (() => { const row = memory.messages.get("wamid.NEW1"); return row?.direction === "out" && row.kind === "text" && row.userId === "alice" && !JSON.stringify(row).includes("Linked."); })());
    reply = { status: 200, json: { messages: [{ id: "wamid.NEW2" }] } };
    await client.sendButtons(to, "Apply?", [{ id: "a", title: "Apply to this job right now please" }, { id: "b", title: "Skip" }]);
    const buttons = (calls.at(-1)!.body.interactive as { action: { buttons: Array<{ reply: { title: string } }> } }).action.buttons;
    check("client: button titles are cut to 20 characters", buttons[0].reply.title.length <= 20 && buttons[1].reply.title === "Skip");
    check("client: 0 or 4 buttons and 11 list rows are refused", (() => { try { client.sendButtons(to, "x", []); return false; } catch { return true; } })() && (() => { try { client.sendButtons(to, "x", Array.from({ length: 4 }, (_, i) => ({ id: String(i), title: "t" }))); return false; } catch { return true; } })() && (() => { try { client.sendList(to, "x", "Choose", Array.from({ length: 11 }, (_, i) => ({ id: String(i), title: "t" }))); return false; } catch { return true; } })());
    reply = { status: 200, json: { messages: [{ id: "wamid.NEW3" }] } };
    await client.sendList(to, "Which team?", "Choose a team", [{ id: "1", title: "Payments core" }]);
    check("client: a list message", (calls.at(-1)!.body.interactive as { type: string }).type === "list");
    reply = { status: 200, json: { messages: [{ id: "wamid.NEW4" }] } };
    await client.sendTemplate(to, "swipeapply_morning", ["12", "4"], []);
    const template = calls.at(-1)!.body.template as { name: string; components: Array<{ parameters: Array<{ text: string }> }> };
    check("client: a template with its variables, recorded as template:<name>", template.name === "swipeapply_morning" && template.components[0].parameters[1].text === "4" && memory.messages.get("wamid.NEW4")?.kind === "template:swipeapply_morning");
    reply = { status: 400, json: { error: { code: 131047, message: "Re-engagement message", error_data: { details: "secret detail with 919876543210" } } } };
    const closed = await client.sendText(to, "hello").catch((error: unknown) => error);
    check("client: 131047 is window_closed, and the error text carries no number", closed instanceof WhatsAppSendError && closed.kind === "window_closed" && closed.code === "131047" && !closed.message.includes("9876543210"));
    reply = { status: 429, json: { error: { code: 130429 } } };
    check("client: 429 is rate_limited", ((await client.sendText(to, "x").catch((error: unknown) => error)) as WhatsAppSendError).kind === "rate_limited");
    reply = { status: 400, json: { error: { code: 131026 } } };
    check("client: an unreachable number", ((await client.sendText(to, "x").catch((error: unknown) => error)) as WhatsAppSendError).kind === "number_unreachable");
    check("client: classifyError", classifyError(500, null) === "other" && classifyError(400, "131047") === "window_closed" && classifyError(429, undefined) === "rate_limited");
    const saved = process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    check("client: no token set is not_configured, with no call made", await (async () => { const before = calls.length; const error = await client.sendText(to, "x").catch((e: unknown) => e); return error instanceof WhatsAppSendError && error.kind === "not_configured" && calls.length === before; })());
    process.env.WHATSAPP_ACCESS_TOKEN = saved;
    check("client: a number that is not a number is refused before any call", await (async () => { const before = calls.length; const error = await client.sendText({ to: "abc", userId: null }, "x").catch((e: unknown) => e); return error instanceof WhatsAppSendError && calls.length === before; })());
    reply = { status: 200, json: { success: true } };
    await client.markRead("wamid.IN1", { typing: true });
    check("client: markRead with the typing indicator, and it never throws", calls.at(-1)!.body.status === "read" && calls.at(-1)!.body.message_id === "wamid.IN1" && JSON.stringify(calls.at(-1)!.body.typing_indicator) === '{"type":"text"}');
  }

  console.log(failed === 0 ? `whatsapp-test PASS (${total} checks)` : `whatsapp-test FAIL (${failed} of ${total} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.log(`whatsapp-test FAIL (threw: ${error instanceof Error ? error.message : String(error)})`);
  process.exit(1);
});
