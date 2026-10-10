// Offline checks for India eligibility (modules/jobs/tagging.ts eligibility, T77): which Greenhouse jobs a candidate
// in India can take. Locations and offices are copied from real boards (Stripe, GitLab, MongoDB, our database).
// npx tsx scripts/eligibility-test.ts
import { plainText } from "../src/modules/jobs/normalize";
import { tagPosting, type Eligibility } from "../src/modules/jobs/tagging";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

type Case = [location: string, offices: string[], description: string, want: Eligibility];
const cases: Case[] = [
  // Located in India
  ["Bengaluru", ["India Locations"], "", "india"],
  ["Bangalore", [], "", "india"],
  ["Gurugram", ["Gurugram @ Gurugram, Haryana, India"], "", "india"],
  ["Mumbai", ["Mumbai @ Mumbai, Maharashtra, India"], "", "india"],
  ["Mohali, IND", [], "", "india"],
  ["Bangalore, India; Remote, Poland", [], "", "india"],
  ["Bengaluru; London", [], "", "india"],
  ["Hyderabad, Telangana", [], "", "india"],
  ["Hybrid", ["Pune @ Pune, India"], "", "india"],
  // Remote and open to India
  ["Remote, India", ["India"], "", "remote_india"],
  ["Remote - India", [], "", "remote_india"],
  ["Remote, Canada; Remote, India", [], "", "remote_india"],
  ["Remote - APAC", [], "", "remote_india"],
  ["Remote, Asia Pacific", [], "", "remote_india"],
  ["Remote (Anywhere)", [], "", "remote_india"],
  ["Worldwide (Remote)", [], "", "remote_india"],
  ["Remote", [], "We hire anywhere in the world; this role overlaps with IST hours.", "remote_india"],
  ["Remote", [], "Open to candidates based in India.", "remote_india"],
  // Abroad: located elsewhere, or remote limited to other countries
  ["Remote from the US", ["US"], "", "abroad"],
  ["US-San Francisco, US-Seattle, US-West Coast (Remote) ", ["US"], "", "abroad"],
  ["Remote, United States", [], "", "abroad"],
  ["Remote, Canada; Remote, United Kingdom; Remote, United States", [], "", "abroad"],
  ["Poland - Remote OR Romania - Remote", ["Poland Locations"], "", "abroad"],
  ["Remote, France", ["France @ France"], "", "abroad"],
  ["Remote, EMEA", [], "", "abroad"],
  ["Remote - LATAM", [], "", "abroad"],
  ["Dublin or Germany (Berlin or Remote)", ["Ireland Locations"], "", "abroad"],
  ["Palo Alto, CA", [], "", "abroad"],
  ["Toronto, Ontario, Canada", [], "", "abroad"],
  ["Singapore", [], "", "abroad"],
  ["Tokyo, Japan", [], "", "abroad"],
  ["Prague, Czech Republic", [], "", "abroad"],
  ["Indianapolis, Indiana", [], "", "abroad"],
  ["Hybrid", ["North America"], "", "abroad"],
  // Found wrong on real boards with the first rules (10 Oct)
  ["CRI - Remote", [], "A global company.", "abroad"], // CRI = Costa Rica
  ["Remote, AMER", [], "Join our global team.", "abroad"],
  ["Remote - CA", [], "", "abroad"],
  ["Remote - NYC", [], "", "abroad"],
  ["São Paulo", [], "We are a global company.", "abroad"],
  ["Remote Ireland; Remote, Australia; Remote, Canada;", ["Global"], "", "abroad"],
  ["CA-British Columbia-Remote", [], "", "abroad"],
  ["US-VA-Remote", [], "", "abroad"],
  ["IL-Israel-Remote", [], "", "abroad"],
  ["Remote - European Union", [], "", "abroad"],
  ["Remote, Global", [], "", "remote_india"],
  ["APJ", [], "", "remote_india"],
  ["Remote", [], "We are a global company with customers worldwide.", "unknown"],
  ["Remote", ["Global"], "", "remote_india"],
  ["Remote", ["US"], "", "abroad"],
  ["Chennai, TN", [], "", "india"],
  ["IN-Pune", [], "", "india"],
  ["Remote - United Arab Emirates", [], "", "abroad"],
  // Nothing to go on: not shown
  ["Remote", [], "Join our distributed team.", "unknown"],
  ["Hybrid", [], "", "unknown"],
  ["N/A", [], "", "unknown"],
  ["", [], "", "unknown"],
];

for (const [location, offices, description, want] of cases) {
  const got = tagPosting({ title: "Software Engineer", location, offices, description }).eligibility;
  check(`${JSON.stringify(location)}${offices.length ? ` / offices ${JSON.stringify(offices)}` : ""}${description ? " / with description" : ""} → ${want}`, got === want, got);
}

// Greenhouse sends descriptions HTML-escaped: its markup must not survive as text.
const escaped = "&lt;h2&gt;&lt;strong&gt;Who we are &lt;/strong&gt;&lt;/h2&gt;&lt;p&gt;We build &amp;amp; ship.&lt;/p&gt;";
check("escaped HTML descriptions come out as plain text", plainText(escaped) === "Who we are We build & ship.", plainText(escaped));

console.log(failed ? `FAIL eligibility (${failed}/${cases.length + 1})` : `PASS eligibility (${cases.length + 1} checks)`);
process.exit(failed ? 1 : 0);
