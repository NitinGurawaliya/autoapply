// One shared browser per worker, one context per run (T100): cookies from one user never reach another, the same user
// gets theirs back on the next run (saved through lib/storage.ts, so on any worker), two runs of one user run side by
// side, an owner name cannot escape its key, a crashed browser is replaced, and 8 runs at once stay in one browser.
// Uses a throwaway local page, no real sites; needs the database. npx tsx scripts/profile-isolation-smoke.ts
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { db } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { openBrowser } from "../src/modules/apply/browser";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

/** This script's own Chromium processes (other programs' browsers are left out) and their private memory. */
function ownChromium() {
  if (process.platform === "win32") {
    const ps = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $ids = New-Object System.Collections.Generic.HashSet[int]; [void]$ids.Add(${process.pid}); do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } } while ($ids.Count -ne $n); $ProgressPreference = 'SilentlyContinue'; Get-Process -Id ([int[]]$ids) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'chrom*' } | Measure-Object -Property PrivateMemorySize64 -Sum | Select-Object Count,Sum | ConvertTo-Json`;
    const out = execSync(`powershell -NoProfile -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const parsed = JSON.parse(out.slice(out.indexOf("{"))) as { Count?: number; Sum?: number };
    return { processes: parsed.Count ?? 0, mb: Math.round((parsed.Sum ?? 0) / 1048576) };
  }
  // Elsewhere: resident memory of the process tree under this script.
  const rows = execSync("ps -eo pid=,ppid=,rss=,comm=").toString().trim().split("\n").map((line) => line.trim().split(/\s+/));
  const tree = new Set([String(process.pid)]);
  for (let size = 0; size !== tree.size; ) {
    size = tree.size;
    for (const [pid, ppid] of rows) if (tree.has(ppid)) tree.add(pid);
  }
  const mine = rows.filter(([pid, , , comm]) => tree.has(pid) && /chrom/i.test(comm ?? ""));
  return { processes: mine.length, mb: Math.round(mine.reduce((sum, row) => sum + Number(row[2]), 0) / 1024) };
}

async function main() {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>form</title><form><input name=a><textarea></textarea><button>Send</button></form><script>for(let i=0;i<2000;i++)document.body.append(document.createElement('div'))</script>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  const stamp = Date.now();
  const userA = `iso-test-a-${stamp}`;
  const userB = `iso-test-b-${stamp}`;
  const sneakyOwner = `../../${userB}`;
  const memoryOwners = Array.from({ length: 8 }, (_, index) => `iso-test-m${index}-${stamp}`);

  try {
    // User A sets a cookie and a localStorage value.
    const a1 = await openBrowser(origin, userA);
    await a1.context.addCookies([{ name: "secret", value: "from-user-a", url: origin, expires: Math.floor(Date.now() / 1000) + 3600 }]);
    await a1.page.evaluate(() => localStorage.setItem("secret", "from-user-a"));
    await a1.close();
    const saved = await storage.get(a1.stateKey);
    check("closing a run saves its cookies to storage, owned by the user", saved?.userId === userA && saved.contentType === "application/json", a1.stateKey);

    // User B must see neither.
    const b = await openBrowser(origin, userB);
    const bCookies = await b.context.cookies(origin);
    const bStorage = await b.page.evaluate(() => localStorage.getItem("secret"));
    check("another user does not see the cookie", !bCookies.some((c) => c.name === "secret"));
    check("another user does not see localStorage", bStorage === null);
    check("state keys are separate", b.stateKey !== a1.stateKey && b.stateKey.includes(userB));
    await b.close();

    // User A comes back and still has theirs.
    const a2 = await openBrowser(origin, userA);
    const aCookies = await a2.context.cookies(origin);
    const aStorage = await a2.page.evaluate(() => localStorage.getItem("secret"));
    check("the same user gets their cookie back", aCookies.some((c) => c.name === "secret" && c.value === "from-user-a"));
    check("the same user gets their localStorage back", aStorage === "from-user-a");
    await a2.close();

    // Two runs of one user at the same time: two contexts of the one shared browser.
    const [r1, r2] = await Promise.all([openBrowser(origin, userA), openBrowser(origin, userA)]);
    check("two runs of one user run in parallel", r1.context !== r2.context && !r1.page.isClosed() && !r2.page.isClosed());
    check("runs share one browser", r1.context.browser() !== null && r1.context.browser() === r2.context.browser());
    await Promise.all([r1.close(), r2.close()]);

    // An owner name cannot escape its key.
    const sneaky = await openBrowser(origin, sneakyOwner);
    check("owner names cannot escape the state key", /^browser-state\/[A-Za-z0-9_-]+\.json$/.test(sneaky.stateKey), sneaky.stateKey);
    await sneaky.close();

    // A crashed browser is replaced by the next run.
    const doomed = await openBrowser(origin, userB);
    const dead = doomed.context.browser();
    await dead?.close();
    await doomed.close();
    const after = await openBrowser(origin, userB);
    check("a crashed browser is relaunched", after.context.browser() !== dead && after.context.browser()?.isConnected() === true);
    await after.close();

    // 8 runs at once. Before T100 (a browser per run), on this page, Windows, 18 Oct: 78 processes, 2,345 MB private.
    const runs = await Promise.all(memoryOwners.map((owner) => openBrowser(origin, owner)));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const memory = ownChromium();
    check("8 runs at once use one browser", new Set(runs.map((run) => run.context.browser())).size === 1);
    check("8 runs at once stay well under 8 browsers' memory", memory.mb > 0 && memory.mb < 1500, `${memory.processes} processes, ${memory.mb} MB`);
    await Promise.all(runs.map((run) => run.close()));
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    server.close();
    for (const owner of [userA, userB, sneakyOwner, ...memoryOwners]) await storage.deleteForUser(owner).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS profile isolation" : `FAIL profile isolation (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
