// Offline checks for experience parsing and match scoring. npx tsx scripts/match-test.ts
import { scoreJob, tierOf } from "../src/modules/jobs";
import { classifyTitle } from "../src/modules/jobs/functions";
import { applyFeedFloor, bandMiss, feedTracks, levelsFor, scoreFeatures, yearsBand } from "../src/modules/jobs/match";
import { levelOn, trackFloor } from "../src/modules/jobs/semantic";
import { requiredYears, titleYears } from "../src/modules/jobs/tagging";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

check("senior title ~5", titleYears("Senior Software Engineer") === 5);
check("intern title 0", requiredYears("Software Engineer Intern", "4+ years of experience") === 0);
check("Engineer III ~5", titleYears("Engineer III") === 5);
check("Engineer II ~2", titleYears("Software Engineer II") === 2);
check("Engineer I 0", titleYears("Software Engineer I") === 0);
check("staff 8", titleYears("Staff Software Engineer") === 8);
check("5+ years of experience", requiredYears("Software Engineer", "You have 5+ years of experience in backend.") === 5);
check("3-5 years lower bound", requiredYears("Software Engineer", "3-5 years of professional experience") === 3);
check("0-2 years", requiredYears("Software Engineer", "0-2 years of experience") === 0);
check("minimum 4 years", requiredYears("Backend Engineer", "Minimum 4 years building APIs.") === 4);
check("experience of 6 years", requiredYears("Backend Engineer", "Relevant experience of at least 6 years") === 6);
check("no info is unknown", requiredYears("Software Engineer", "Join our team and build great things.") === null);
// 20 Nov: the quality floor (cards under FEED_FLOOR are hidden, but never fewer than FEED_FLOOR_MIN).
{
  const card = (id: string, score: number, source = "greenhouse") => ({ id, score, source });
  const ids = (list: Array<{ id: string }>) => list.map((job) => job.id).join(",");
  const ranked = [card("a", 82), card("b", 71), card("c", 66), card("d", 63), card("e", 50)];
  check("floor: cards under it are hidden, order kept", ids(applyFeedFloor(ranked, 65, 2)) === "a,b,c");
  check("floor: nothing hidden when every card passes", applyFeedFloor([card("a", 80), card("b", 70)], 65, 5).length === 2);
  check("floor: never fewer than the minimum, the best-ranked ones", ids(applyFeedFloor([card("a", 70), card("b", 60), card("c", 58), card("d", 40)], 65, 3)) === "a,b,c");
  check("floor: a card that passes ranks below sub-floor ones and is still kept, in rank order", ids(applyFeedFloor([card("a", 60), card("b", 50), card("c", 70)], 65, 2)) === "a,c");
  check("floor: off at 0", ids(applyFeedFloor(ranked, 0, 5)) === "a,b,c,d,e");
  check("floor: mock jobs always pass", ids(applyFeedFloor([card("a", 80), card("m", 10, "mock")], 65, 1)) === "a,m");
  check("floor: an empty feed stays empty", applyFeedFloor([], 65, 5).length === 0);
}
// 20 Nov: phrasings real postings use that reached 0-1 year candidates unread.
check("an HTML entity between the number and 'years'", requiredYears("SDE Backend", "3+&#xa0;years of experience (real world, not academic).") === 3);
check("'N+ years in' a field", requiredYears("Application Security Specialist", "About you • 5+ years in Application Security, Cyber Security.") === 5);
check("'N+ years designing'", requiredYears("Java Software Engineer", "7+ years designing and building large-scale distributed systems.") === 7);
check("a number written as a word", requiredYears("Python Software Developer", "A minimum of five years of professional experience developing software.") === 5);
check("'Five or more years in'", requiredYears("Identity Security Engineer", "Five or more years in security engineering.") === 5);
check("'5-8 years development'", requiredYears("R&D Engineer (C++)", "Seniority: 5-8 years development including 2–3 years tools.") === 5);
check("'Experience: 1-5'", requiredYears("C++ Engineer", "Experience: 1-5 Must Have Strong programming skills in C++.") === 1);
check("a company's own years are not asked of the candidate", requiredYears("Software Engineer", "We have 10+ years in business and serve 500 clients. Join us.") === null);
check("'one of the best teams' is not a year count", requiredYears("Software Engineer", "Join one of the best teams in the world.") === null);

const junior = {
  currentTitle: "MERN Stack Developer",
  skills: ["React", "Node.js", "MongoDB", "Express", "JavaScript", "TypeScript", "HTML", "CSS"],
  yearsExperience: 1,
  preferredLocations: [],
};
const base = { country: "IN", remoteType: "unknown", experienceMin: null as number | null };
const stack = "We use React, Node.js, MongoDB, Express, JavaScript, TypeScript, HTML and CSS.";

const senior = scoreJob({ ...base, title: "Senior Software Engineer", description: `${stack} 5+ years of experience required.` }, junior);
const four = scoreJob({ ...base, title: "Software Engineer", description: `${stack} Minimum 4 years of experience.` }, junior);
const entry = scoreJob({ ...base, title: "Software Engineer", description: `${stack} 0-2 years of experience.` }, junior);
const grad = scoreJob({ ...base, title: "Graduate Developer", description: stack }, junior);
const twoYr = scoreJob({ ...base, title: "Software Engineer", description: `${stack} 2+ years of experience.` }, junior);

check("senior role for 1 yr dev stays under 40", senior.score < 40, `${senior.score}%`);
check("4 yr role stays under 40", four.score < 40, `${four.score}%`);
check("entry role scores well", entry.score >= 60, `${entry.score}%`);
check("graduate role scores well", grad.score >= 60, `${grad.score}%`);
// One year of stretch (owner, 23 Nov; yearsReach): a 2-year ask stays for a 1-yr dev, scored on its fit; 3 years is out.
check("2 yr ask stays for a 1 yr dev", twoYr.score >= 40, `${twoYr.score}% ${twoYr.reason}`);
check("reason explains seniority", /years/i.test(senior.reason), senior.reason);

// T82: tiers, by tracks (no vectors) and by meaning plus the model's verdict (semantic.ts).
const dev = { ...junior, tracks: ["fullstack", "frontend", "backend"] };
const ds = { currentTitle: "Data Scientist", skills: ["Python", "Pandas", "SQL", "Statistics"], yearsExperience: 2, preferredLocations: [], tracks: ["data_science"] };
const tracked = (title: string, description: string, who: typeof dev | typeof ds) => scoreJob({ ...base, title, description }, who);
check("by tracks: an entry full-stack role for a 1-yr MERN dev is strong or good", ["strong", "good"].includes(tierOf(tracked("Full Stack Engineer", `${stack} 0-2 years of experience.`, dev).score, 40) ?? ""), String(tracked("Full Stack Engineer", `${stack} 0-2 years.`, dev).score));
check("by tracks: a frontend role is not shown to a data scientist", tracked("Senior Frontend Engineer", "React and CSS.", ds).score === 0);
check("by tracks: a sales role is not shown to a developer", tracked("Account Executive", "Sell our product.", dev).score === 0);
check("by tracks: a data scientist sees data science roles", (tierOf(tracked("Data Scientist", "Python, SQL, Pandas and statistics. 2+ years of experience.", ds).score, 40) ?? "") !== "");
const meaning = (similarity: number, fit: "strong" | "good" | "stretch" | "no" | null, extra: Partial<{ title: string; description: string }> = {}) =>
  scoreJob({ ...base, title: extra.title ?? "Software Engineer", description: extra.description ?? `${stack} 0-2 years of experience.`, similarity, judgement: fit ? { fit, why: "test" } : null }, dev);
check("by meaning: close and judged strong → strong", tierOf(meaning(0.6, "strong").score, 40) === "strong", String(meaning(0.6, "strong").score));
check("by meaning: judged no → out, whatever the closeness", meaning(0.65, "no").score === 0);
check("by meaning: below the floor → out", meaning(0.3, "good").score === 0);
check("by meaning: unjudged needs to be closer", meaning(0.4, null).score === 0 && meaning(0.5, null).score > 0);
check("by meaning: a senior role for a 1-yr dev stays low even if close", meaning(0.6, "stretch", { title: "Senior Software Engineer", description: `${stack} 5+ years of experience required.` }).score < 40);
const intern = { title: "SDE Intern - Backend", description: "Backend services in Node.js and MongoDB. Our story: awards, funding rounds and offices." };
// Phase N: the verdict floor needs half the job's skills; an intern role in Go and SQL is not lifted for a MERN dev.
const otherStack = { title: "SDE Intern - Backend", description: "Backend services in Go and SQL. Our story: awards, funding rounds and offices." };
check("by meaning: a good verdict is not lifted when the candidate has none of the job's skills", meaning(0.39, "good", otherStack).score < 60, String(meaning(0.39, "good", otherStack).score));
check("by meaning: a good verdict on an intern role that fits is not Stretch, even when far by meaning", ["good", "strong"].includes(tierOf(meaning(0.39, "good", intern).score, 40) ?? ""), String(meaning(0.39, "good", intern).score));
check("by meaning: a strong verdict that fits is strong", tierOf(meaning(0.38, "strong", intern).score, 40) === "strong", String(meaning(0.38, "strong", intern).score));
check("by meaning: the floor does not lift a job asking more years", tierOf(meaning(0.39, "good", { description: `${stack} 3+ years of experience.` }).score, 40) !== "good", String(meaning(0.39, "good", { description: `${stack} 3+ years of experience.` }).score));
check("by meaning: the verdict's reason is shown", /^Test/.test(meaning(0.6, "strong").reason), meaning(0.6, "strong").reason);

// 19 Oct: the model called frontend, backend and full-stack roles "different" for a full-stack developer; the title's track sets a floor.
const web = ["fullstack", "backend", "frontend"];
check("track floor: a frontend role is at least close for a full-stack developer", trackFloor("Software Engineer II, Frontend (Bangalore, India)", web).field === "close", trackFloor("Software Engineer II, Frontend (Bangalore, India)", web).field);
check("track floor: a full-stack role is at least close", trackFloor("Platform Engineer - Full Stack (UI Centric)", web).field === "close", trackFloor("Platform Engineer - Full Stack (UI Centric)", web).field);
check("track floor: a plain Software Engineer is related for a web developer, not close", trackFloor("Software Engineer", web).field === "related", trackFloor("Software Engineer", web).field);
check("track floor: a mobile role is at least related for a frontend developer", trackFloor("Android Developer", ["frontend"]).field === "related", trackFloor("Android Developer", ["frontend"]).field);
check("track floor: sales and recruiting get no floor", trackFloor("Account Executive", web).field === "different" && trackFloor("Technical Recruiter", web).field === "different");
check("track floor: a data scientist gets no floor on a frontend role", trackFloor("Frontend Engineer", ["data_science"]).field === "different", trackFloor("Frontend Engineer", ["data_science"]).field);
// Strict matching (9 Nov, owner: "only exact matches"): the cards the feed audit found off-target, as cases.
// Real titles from the owner's and Nitin's feeds (scripts/feed-audit.ts, before the change).
const nitin = { ...dev, yearsExperience: 1, tracks: ["ml_ai", "fullstack", "backend", "frontend", "software"] };
const fresher = { ...dev, yearsExperience: 0 };
const owner = { ...dev, yearsExperience: null, tracks: ["fullstack", "backend", "frontend"] };
const judged = (title: string, description: string, who: typeof dev | typeof owner, fit: "strong" | "good" | "stretch" = "good", similarity = 0.62) =>
  scoreJob({ ...base, title, description, similarity, judgement: { fit, why: "test" } }, who);
check("strict: SDE II for a 1-yr dev is out, even judged good and close", judged("SDE II - Python Engineer", stack, nitin).score === 0, judged("SDE II - Python Engineer", stack, nitin).reason);
check("strict: Software Engineer II for a 1-yr dev is out", judged("Software Engineer II", stack, nitin, "strong", 0.7).score === 0);
check("strict: Software Development Engineer 2 (SDE 2) for a fresher is out", judged("Software Development Engineer 2 (SDE 2)", stack, fresher).score === 0);
check("strict: a 3-year ask for a 1-yr dev is out", judged("Software Engineer 1", `${stack} 3+ years of experience.`, nitin, "stretch").score === 0);
check("strict: a 3-year ask for the owner (years unknown = fresher) is out", judged("Software Engineer", `${stack} 3+ years of experience.`, owner, "stretch").score === 0);
check("stretch: a 2-year ask for the owner (years unknown = fresher) stays", judged("Software Engineer", `${stack} 2+ years of experience.`, owner, "good").score > 0);
check("strict: a 1-year ask for a fresher stays", judged("Frontend Developer", `${stack} 1+ years of experience.`, fresher).score >= 40);
check("strict: a stated mid level with no years is out for a 1-yr dev", scoreFeatures({ title: "Engineer", seniority: "mid", requiredYears: null, country: "IN", remoteType: "unknown", skillHits: [], similarity: 0.6, judgement: { fit: "strong", why: "t" } }, nitin).score === 0);
check("strict: Senior for 3 years is out, for 5 it stays", judged("Senior Software Engineer", stack, { ...nitin, yearsExperience: 3 }).score === 0 && judged("Senior Software Engineer", stack, { ...nitin, yearsExperience: 5 }).score >= 40);
check("strict: SDE II for 2 years stays", judged("SDE II - Python Engineer", stack, { ...nitin, yearsExperience: 2 }).score >= 40);
check("strict: an intern role is out from 3 years", judged("Software Engineer Intern", stack, { ...nitin, yearsExperience: 3 }).score === 0);
check("strict: an intern role stays for a fresher", tierOf(judged("Full Stack Development Intern", stack, fresher, "strong").score, 40) === "strong");
const unstated = judged("React Engineer", stack, nitin, "strong", 0.7);
check("strict: a job stating neither years nor level is never Strong", unstated.score > 0 && tierOf(unstated.score, 40) === "good", String(unstated.score));
check("strict: bandMiss says why", bandMiss({ requiredYears: 3, seniority: null }, 1) === "They want about 3+ years; you have 1" && bandMiss({ requiredYears: 2, seniority: null }, 1) === null && bandMiss({ requiredYears: 2, seniority: "mid" }, 1) === "A mid role, above your experience" && bandMiss({ requiredYears: null, seniority: "senior" }, 1) === "A senior role, above your experience");
check("strict: years band", [yearsBand(0), yearsBand(1), yearsBand(1.9), yearsBand(3), yearsBand(null)].join() === "1,1,1,3,1");
check("strict: levels for a 1-yr dev are intern and entry", levelsFor(1).join() === "intern,entry", levelsFor(1).join());
check("strict: levels for 6 years", levelsFor(6).join() === "mid,senior,staff,manager", levelsFor(6).join());
check("strict: a web developer's feed tracks are their own plus plain software", feedTracks(["fullstack", "backend", "frontend"])?.join() === "fullstack,backend,frontend,software");
check("strict: data engineering, DevOps, mobile and solutions are not in a web developer's feed", !["data_engineering", "devops", "mobile", "solutions"].some((t) => feedTracks(["fullstack", "backend", "frontend"])!.includes(t)));
check("strict: a data scientist's feed has no plain software roles", feedTracks(["data_science"])?.join() === "data_science");
check("strict: a profile without tracks has no track gate", feedTracks([]) === null);
check("nearby (P4): a data scientist's feed with nearby on adds ML/AI and data engineering", feedTracks(["data_science"], true)?.join() === "data_science,ml_ai,data_engineering");
check("nearby (P4): off by default, so adjacent tracks stay out", !feedTracks(["data_science"])!.includes("ml_ai"));
check("nearby (P4): a profile without tracks still has no track gate", feedTracks([], true) === null);
check("titles: SDE1-Java is software", classifyTitle("SDE1-Java").track === "software");
check("titles: a mechanical engineering internship is not software", classifyTitle("Mechanical Engineer - Internship").track === null);
check("titles: trainers and tool admins are not tech", classifyTitle("Intern - Tech Trainer (Jan 2027 Batch)").track === null && classifyTitle("AI Tool Admin").track === null);
const notSoftware = ["Junior Metallurgist / Engineer", "Manufacturing Engineer", "Structural Design and Analysis Engineer", "Junior Sourcing Engineer", "Junior/Trainee Engineer- Electrical", "AI Filmmaker", "Management Trainee - AI Operations", "Associate Engineer, Manufacturing"];
check("titles: other engineering disciplines are not software", notSoftware.every((t) => classifyTitle(t).track === null), notSoftware.filter((t) => classifyTitle(t).track !== null).join(" | "));
const stillSoftware = ["Software Engineer, Manufacturing Infrastructure", "Sr. Software Engineer - Manufacturing Data & Test Infrastructure", "Senior Solutions Engineer (Manufacturing, Automotive, Defence)", "Product Engineer (Mobile)"];
check("titles: software roles in manufacturing stay tech", stillSoftware.every((t) => classifyTitle(t).track !== null), stillSoftware.filter((t) => classifyTitle(t).track === null).join(" | "));

// Phase P, P3: the one gate in the scorers (gate.ts jobGate). The feed passes the effective tracks with the field part;
// the swipe check passes field: false. The score keeps the title's track.
const webTracks = feedTracks(["fullstack", "backend", "frontend"]);
const reading = (title: string, track: string, over: { roleFamily?: string; kind?: string; flags?: string[] } = {}) =>
  ({ source: "greenhouse", title, track, roleFamily: over.roleFamily ?? track, kind: over.kind ?? "employee", flags: over.flags ?? [], readingCurrent: true });
const gated = (title: string, track: string, over: Parameters<typeof reading>[2], field: boolean, tracks = webTracks) =>
  scoreJob({ ...base, title, description: `${stack} 0-1 years of experience.`, track, similarity: 0.6, judgement: { fit: "good", why: "test" } }, nitin, { job: reading(title, track, over), tracks: field ? tracks : null, field });
check("gate: a backend job read as backend scores as before", gated("Backend Engineer", "backend", {}, true).score === judged("Backend Engineer", `${stack} 0-1 years of experience.`, nitin, "good", 0.6).score);
const readOut = gated("Backend Engineer", "backend", { roleFamily: "data_engineering" }, true);
check("gate: a backend title read as data engineering is out of a web developer's feed", readOut.score === 0 && readOut.reason === "Not your field (Backend)", readOut.reason);
check("gate: a reading in the tracks never puts a job in (title outside)", gated("Data Engineer", "data_engineering", { roleFamily: "backend" }, true).score === 0);
const sales = gated("Software Engineer", "software", { roleFamily: "non_tech" }, false);
check("gate: a job read as non-tech is out, even at the swipe check", sales.score === 0 && sales.reason === "Not a tech role", sales.reason);
check("gate: a paid task is out at the swipe check", gated("Frontend Engineer", "frontend", { flags: ["paid_task"] }, false).score === 0);
check("gate: a gig is out", gated("Frontend Engineer", "frontend", { kind: "gig" }, true).score === 0);
check("gate: the swipe check ignores the field (any track filter)", gated("Data Engineer", "data_engineering", { roleFamily: "data_engineering" }, false).score > 0);
check("gate: a contract role stays with no avoid", gated("Frontend Engineer", "frontend", { kind: "contract" }, true).score > 0);
check("gate: mock jobs always pass", scoreJob({ ...base, title: "Account Executive", description: stack, similarity: 0.6, judgement: { fit: "good", why: "t" } }, nitin, { job: { source: "mock", title: "Account Executive", roleFamily: "non_tech", readingCurrent: true }, tracks: webTracks, field: true }).score > 0);
// P6: both verdict paths score through the same code. A fit verdict (fit.ts) carries the requirement line it rests on;
// the score and reason are those of the same verdict from the old judge, and the level rules apply on top (levelOn).
const withQuote = (fit: "strong" | "good" | "stretch") =>
  scoreJob({ ...base, title: "Software Engineer", description: `${stack} 0-2 years of experience.`, similarity: 0.55, judgement: { fit, why: "React and Node work, like yours", quote: "Strong React and Node.js" } }, dev);
const withoutQuote = (fit: "strong" | "good" | "stretch") =>
  scoreJob({ ...base, title: "Software Engineer", description: `${stack} 0-2 years of experience.`, similarity: 0.55, judgement: { fit, why: "React and Node work, like yours" } }, dev);
check("fit path: a verdict with its quote scores as the old path's same verdict", (["strong", "good", "stretch"] as const).every((fit) => withQuote(fit).score === withoutQuote(fit).score && withQuote(fit).reason === withoutQuote(fit).reason));
check("fit path: the level on top (a senior title for 1 year is no)", levelOn("strong", "Senior Software Engineer", null, 1).fit === "no" && levelOn("good", "Software Engineer", 2, 1).fit === "good");
console.log(failed === 0 ? "PASS match logic" : `FAIL match logic (${failed})`);
process.exit(failed === 0 ? 0 : 1);
