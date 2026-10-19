// T93 India company probe (19 Oct): Indian product companies, startups and India-heavy employers, each checked on
// Greenhouse, Lever and Ashby through their public job APIs (no login, nothing scraped). A company with at least one
// open tech job in India or remote-India is added (Company.addedBy = discovery); every name checked is recorded in
// DiscoveryCandidate (from "probe") so it is not checked again. Prints per board what was found and added, and the
// India tech and junior jobs the added companies bring. npx tsx scripts/probe-india-companies.ts [--dry]
import { db } from "../src/lib/db";
import { fetchAshby } from "../src/modules/jobs/fetchers/ashby";
import { fetchGreenhouse } from "../src/modules/jobs/fetchers/greenhouse";
import { fetchLever } from "../src/modules/jobs/fetchers/lever";
import { classifyTitle } from "../src/modules/jobs/functions";
import type { FetchedJob } from "../src/modules/jobs/normalize";
import { tagPosting } from "../src/modules/jobs/tagging";

// Names as companies call themselves; the slug is guessed from the name (and the extra slugs after "|").
const COMPANIES = `
Razorpay|razorpaysoftwareprivatelimited; Paytm; PhonePe; CRED|dreamplug; Zerodha; Groww; Upstox; Angel One|angelbroking; INDmoney; Smallcase;
Jupiter|jupitermoney; Fi|fimoney; Niyo|niyosolutions; Slice|sliceit; Uni|unicards; OneCard|fplabs; Zeta|zetasuite; Juspay; Cashfree|cashfreepayments; Pine Labs|pinelabs;
BharatPe; MobiKwik; Navi|navitechnologies; KreditBee; MoneyView|whizdm; Lendingkart; Rupeek; Stashfin; Perfios; Setu|setuhq;
M2P Fintech|m2p; Decentro; Signzy; IDfy; HyperVerge; Zolve; Yubi|credavenue; Open|openfinancial; Khatabook; OkCredit;
Swiggy; Zomato|eternal; Zepto|kiranakart; Blinkit; Dunzo; BigBasket; Meesho; Flipkart; Myntra; Nykaa;
Lenskart; FirstCry; Purplle; Mamaearth|honasa; boAt|imaginemarketing; Licious; Country Delight|countrydelight; Udaan; DealShare; Citymall;
Ola|olacabs; Ola Electric|olaelectric; Rapido; Uber India|uber; Ather Energy|atherenergy; Yulu; BluSmart; Porter; Shiprocket; Delhivery;
BlackBuck; Rivigo; LoadShare; Locus|locussh; FarEye; Shadowfax; Ecom Express|ecomexpress; Xpressbees; Ninjacart; DeHaat;
Unacademy; Physics Wallah|physicswallah; BYJU'S|byjus; upGrad|upgrad; Vedantu; Scaler|interviewbit; Coding Ninjas|codingninjas; Masai School|masaischool; Newton School|newtonschool; Simplilearn;
Classplus; Teachmint; LEAD School|leadschool; Eruditus; Great Learning|greatlearning; Testbook; Adda247; Cuemath; Toddle; Seekho;
Freshworks; Zoho; Chargebee; Postman; BrowserStack; Hasura; Druva; Icertis; Darwinbox; LeadSquared;
Mindtickle; Whatfix; MoEngage; CleverTap; WebEngage; Netcore|netcorecloud; Gupshup; Yellow.ai|yellowai; Haptik; Uniphore;
Sprinklr; Innovaccer; Highradius; Zenoti; Capillary|capillarytech; Exotel; Ozonetel; Kaleyra; Freshdesk; SpotDraft;
Rocketlane; Zluri; Sprinto; Scrut|scrutautomation; CloudSEK; Appsmith; ToolJet; Dyte; 100ms|100mslive; Plane|makeplane;
Composio; Sarvam AI|sarvam; Krutrim; Atlan; Hevo Data|hevodata; Everstage; Zenduty; DevRev; Observe.AI|observeai; Ema|emaunlimited;
Glean; Rubrik; Nutanix; InMobi; Glance; Dailyhunt|versemedia; ShareChat|mohalla; Pocket FM|pocketfm; Kuku FM|kukufm; Pratilipi;
Dream11|dreamsports; Games24x7; MPL|mobilepremierleague; WinZO; Nazara; Junglee Games|jungleegames; Zupee; Rooter; Loco; STAGE|stage;
Practo; PharmEasy; Tata 1mg|1mg; Pristyn Care|pristyncare; HealthifyMe; Cult.fit|curefit; Innovaccer|innovaccerinc; Qure.ai|qureai; Eka Care|ekacare; Plum|plumhq;
Acko; Digit Insurance|godigit; PolicyBazaar; Turtlemint; InsuranceDekho; Onsurity; Loop Health|loophealth; Even Healthcare|evenhealthcare; Ditto|joinditto; RenewBuy;
MakeMyTrip; ixigo; Cleartrip; EaseMyTrip; OYO|oyorooms; Treebo; Zostel; Atlys; Scapia; Airblack;
CARS24|cars24; Spinny; CarDekho; Droom; OLX India|olx; NoBroker; Housing.com|housing; Square Yards|squareyards; Livspace; HomeLane;
Pepperfry; Urban Company|urbancompany; Rentomojo; Furlenco; Zoomcar; Apna|apnatime; WorkIndia; Instahyre; Cutshort; Unstop;
Internshala; HackerEarth; HackerRank; Naukri|infoedge; Info Edge|infoedge; Times Internet|timesinternet; Jio Platforms|jio; Airtel|bhartiairtel; Tata Digital|tatadigital; Reliance Retail|relianceretail;
Fynd; GoKwik; Shopflo; Dukaan; Bikayi; Zepto Cafe|zeptonow; Swiggy Instamart|instamart; Magicpin; Thrive|thrivenow; Petpooja;
Vyapar; myBillBook|flobiz; Refrens; Zoho Books|zohobooks; Cashify; Servify; Wakefit; Sleepy Owl|sleepyowl; Bewakoof; The Souled Store|thesouledstore;
Sigmoid; Fractal|fractalanalytics; Tredence; LatentView|latentview; Mu Sigma|musigma; Tiger Analytics|tigeranalytics; Quantiphi; Gramener; Course5|course5i; Affine;
Tekion; Uniphore|uniphoresoftware; Zeotap; Leena AI|leenaai; Mad Street Den|madstreetden; Vue.ai|vueai; Arya.ai|aryaai; SigTuple; Niramai; Tricog;
Ultrahuman; Noise|gonoise; Boult|boultaudio; Agnikul|agnikulcosmos; Skyroot|skyrootaerospace; Pixxel; Bellatrix|bellatrixaerospace; ideaForge|ideaforge; Ather|atherenergyltd; Log9|log9materials;
Simpl|getsimpl; LazyPay; ZestMoney; Fibe|earlysalary; Kissht; Pagarbook; Juno|junoapp; Fam|fampay; Akudo; Leap|leapfinance;
Yocket; LeapScholar|leapscholar; Univariety; Collegedunia; Shiksha; CollegeDekho; Embibe; Toppr; Doubtnut; Lido|lidolearning;
Groww Pay|growwpay; CoinDCX; CoinSwitch|coinswitchkuber; WazirX; Mudrex; Giottus; Polygon|polygontechnology; Biconomy; Push Protocol|pushprotocol; Router Protocol|routerprotocol;
Paytm Money|paytmmoney; Dhan|dhanhq; Sensibull; Streak|streaktech; Quicko; ClearTax|clear; Tally Solutions|tallysolutions; Zoho Payroll|zohopayroll; greytHR|greytip; Keka|kekahr;
Instamojo; PayU|payu; CCAvenue|infibeam; Paysense; Cred Mint|credmint; Easebuzz; Open Money|bankopen; Paymeindia; Volopay; Happay;
`;

type Board = { source: "greenhouse" | "lever" | "ashby"; fetch: (slug: string) => Promise<FetchedJob[]> };
const BOARDS: Board[] = [
  { source: "greenhouse", fetch: fetchGreenhouse },
  { source: "lever", fetch: fetchLever },
  { source: "ashby", fetch: fetchAshby },
];
const JUNIOR = /\b(intern(ship)?|graduate|fresher|trainee|apprentice|entry[- ]level|junior|jr\.?|associate|sde[ -]?(1|i)|engineer[ -]?(1|i))\b/i;
const slugify = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const normal = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const dry = process.argv.includes("--dry");
  const entries = COMPANIES.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...extra] = part.split("|").map((x) => x.trim());
    return { name, slugs: [...new Set([slugify(name), ...extra.map((x) => x.toLowerCase())])].filter((s) => s.length >= 2) };
  });
  const known = await db.company.findMany({ select: { name: true, source: true, slug: true } });
  const knownNames = new Set(known.map((c) => normal(c.name)));
  const knownSlugs = new Set(known.map((c) => `${c.source}:${c.slug}`));
  const queue = entries.filter((e) => !knownNames.has(normal(e.name)));
  console.log(`candidates ${entries.length}; already ours ${entries.length - queue.length}; probing ${queue.length} on ${BOARDS.length} boards`);

  const perBoard = new Map<string, { live: number; added: number; indiaTech: number; junior: number }>();
  for (const b of BOARDS) perBoard.set(b.source, { live: 0, added: 0, indiaTech: 0, junior: 0 });
  const added: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const entry = queue[next++];
      let found = false;
      for (const board of BOARDS) {
        for (const slug of entry.slugs) {
          if (knownSlugs.has(`${board.source}:${slug}`)) continue;
          const jobs = await board.fetch(slug).catch(() => null);
          await pause(250);
          if (!jobs) continue;
          const stats = perBoard.get(board.source)!;
          stats.live += 1;
          const indiaTech = jobs.filter((job) => {
            const { eligibility } = tagPosting(job);
            return (eligibility === "india" || eligibility === "remote_india") && classifyTitle(job.title).function !== "non_tech";
          });
          const junior = indiaTech.filter((job) => JUNIOR.test(job.title) || ["intern", "entry"].includes(classifyTitle(job.title).seniority ?? "")).length;
          const pass = indiaTech.length >= 1;
          if (!dry) {
            if (pass) {
              await db.company.upsert({ where: { source_slug: { source: board.source, slug } }, create: { source: board.source, slug, name: entry.name, addedBy: "discovery" }, update: {} });
            }
            await db.discoveryCandidate.upsert({
              where: { source_name: { source: board.source, name: entry.name } },
              create: { source: board.source, name: entry.name, slug, from: "probe", status: pass ? "added" : "few_india_jobs", openJobs: jobs.length, indiaJobs: indiaTech.length },
              update: { slug, status: pass ? "added" : "few_india_jobs", openJobs: jobs.length, indiaJobs: indiaTech.length, checkedAt: new Date() },
            });
          }
          if (pass) {
            stats.added += 1;
            stats.indiaTech += indiaTech.length;
            stats.junior += junior;
            added.push(`${entry.name} (${board.source}/${slug}): ${indiaTech.length} India tech, ${junior} junior`);
          }
          found = true;
          break;
        }
      }
      if (!found && !dry) {
        await db.discoveryCandidate.upsert({ where: { source_name: { source: "greenhouse", name: entry.name } }, create: { source: "greenhouse", name: entry.name, from: "probe", status: "not_on_board" }, update: { checkedAt: new Date() } }).catch(() => undefined);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  for (const line of added.sort()) console.log(`ADDED ${line}`);
  for (const [source, s] of perBoard) console.log(`BOARD ${source.padEnd(10)} live boards ${s.live} | added ${s.added} | India tech jobs ${s.indiaTech} | junior ${s.junior}`);
  const totals = [...perBoard.values()].reduce((a, s) => ({ added: a.added + s.added, indiaTech: a.indiaTech + s.indiaTech, junior: a.junior + s.junior }), { added: 0, indiaTech: 0, junior: 0 });
  console.log(`${dry ? "DRY RUN" : "DONE"}: ${totals.added} companies added, ${totals.indiaTech} India tech jobs, ${totals.junior} junior; run an ingest to store them.`);
}

main().finally(() => db.$disconnect());
