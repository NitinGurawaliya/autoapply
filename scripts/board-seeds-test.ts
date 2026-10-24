// Board identifiers from addresses and hand-made lists (modules/jobs/boardSeeds.ts). No network, no database.
import { boardFromUrl, seedsFromText } from "../src/modules/jobs/boardSeeds";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const checks: Array<[string, boolean]> = [
  ["greenhouse job page", same(boardFromUrl("https://boards.greenhouse.io/acme/jobs/123"), { source: "greenhouse", slug: "acme" })],
  ["greenhouse new host", same(boardFromUrl("https://job-boards.greenhouse.io/acme"), { source: "greenhouse", slug: "acme" })],
  ["greenhouse eu host", same(boardFromUrl("https://job-boards.eu.greenhouse.io/acme/jobs/1"), { source: "greenhouse", slug: "acme" })],
  ["greenhouse embed names the board in 'for'", same(boardFromUrl("https://boards.greenhouse.io/embed/job_board?for=Acme"), { source: "greenhouse", slug: "acme" })],
  ["lever job page, no scheme", same(boardFromUrl("jobs.lever.co/acme-labs/0b1c-uuid"), { source: "lever", slug: "acme-labs" })],
  ["ashby application page", same(boardFromUrl("https://jobs.ashbyhq.com/Acme/123/application"), { source: "ashby", slug: "acme" })],
  ["other hosts are not boards", boardFromUrl("https://example.com/acme") === null],
  ["api path is not a board", boardFromUrl("https://boards.greenhouse.io/v1/boards") === null],
  ["host with no board", boardFromUrl("https://jobs.lever.co/") === null],
  [
    "a CSV with URLs anywhere on the line",
    same(seedsFromText('name,url\nAcme,"https://jobs.lever.co/acme/1"\nBeta, https://jobs.ashbyhq.com/beta ; x\nnothing here').seeds, [
      { source: "lever", slug: "acme" },
      { source: "ashby", slug: "beta" },
    ]),
  ],
  ["bare identifiers count for the one ATS given", same(seedsFromText("acme\nbeta-co\n", "greenhouse").seeds.map((seed) => seed.slug), ["acme", "betaco"])],
  ["bare identifiers are ignored without an ATS", seedsFromText("acme\nbeta\n").seeds.length === 0],
  ["URLs are counted", seedsFromText("https://jobs.lever.co/a https://jobs.lever.co/b").urls === 2],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? "PASS board-seeds" : `FAIL board-seeds (${failed})`);
process.exit(failed === 0 ? 0 : 1);
