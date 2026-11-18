// The logo found in each board's page (modules/jobs/logos.ts). Sample markup as the boards wrote it on 24 Oct; no network.
import { domainCandidates, logoFromHtml, ownSiteOf, siteRoot, websiteFromHtml, workdayLogoUrl } from "../src/modules/jobs/logos";

const sure = (list: Array<{ host: string; sure: boolean }>) => list.filter((item) => item.sure).map((item) => item.host);

const greenhouse = `<meta property="og:image" content="https://s7-recruiting.cdn.greenhouse.io/x/og.jpg"/><img src="https://s7-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/307/300/original/Logo-01_(1).jpg?1700670705" alt="Arcesium LLC Logo" class="logo"/>`;
const lever = `<meta property="og:image" content="https://lever-client-logos.s3.us-west-2.amazonaws.com/banner.png" /><img alt="Saviynt logo" src="https://lever-client-logos.s3.us-west-2.amazonaws.com/ce99b770-1764798903876.png">`;
const ashby = `{"logoWordmarkImageUrl":"https://app.ashbyhq.com/api/images/org-theme-wordmark/a.png","logoSquareImageUrl":"https://app.ashbyhq.com/api/images/org-theme-logo/b.png"}`;

const keka = `{"name":"Techdome","logoPath":"careerportal/35329207318a4920b84683c4dcbed55f.png","careersBackgroundPath":"/ats/documents/db914ff9-927c-40ee-8942-23c09ee515ce/https://cdn.keka.com/shared/assets/images/components/careers/banner.jpg","careersPortalDomain":"techdome.keka.com"}`;

const checks: Array<[string, boolean]> = [
  ["keka: logoPath in the tenant's documents folder on the portal host", logoFromHtml("keka", keka) === "https://techdome.keka.com/ats/documents/db914ff9-927c-40ee-8942-23c09ee515ce/careerportal/35329207318a4920b84683c4dcbed55f.png"],
  ["keka: no background path, the folder id from the careers page", logoFromHtml("keka", `{"logoPath":"orglogo/9ca0.png","careersBackgroundPath":"","careersPortalDomain":"accredian.keka.com"}<script>fetch('/ats/documents/0cb335b6-2fec-4b9f-8166-dbbeddd36c41/careerportal/1.html')</script>`) === "https://accredian.keka.com/ats/documents/0cb335b6-2fec-4b9f-8166-dbbeddd36c41/orglogo/9ca0.png"],
  ["keka: no logoPath, null", logoFromHtml("keka", `{"name":"X","careersBackgroundPath":"/ats/documents/db914ff9-927c-40ee-8942-23c09ee515ce/x","careersPortalDomain":"x.keka.com"}`) === null],
  ["greenhouse: the image marked class=logo", logoFromHtml("greenhouse", greenhouse)?.endsWith("Logo-01_(1).jpg?1700670705") === true],
  ["lever: the image whose alt says logo, not the og:image banner", logoFromHtml("lever", lever)?.endsWith("1764798903876.png") === true],
  ["ashby: the square logo, not the wordmark", logoFromHtml("ashby", ashby) === "https://app.ashbyhq.com/api/images/org-theme-logo/b.png"],
  ["greenhouse: a logo in its logo folder without the class", logoFromHtml("greenhouse", `<img src="https://s4-recruiting.cdn.greenhouse.io/job_board_renderer/banners/b.png"><img src="https://s4-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/653/100/original/Logo.jpg?1" alt="66degrees">`)?.endsWith("Logo.jpg?1") === true],
  ["ashby: the wordmark when there is no square logo", logoFromHtml("ashby", `{"logoWordmarkImageUrl":"https://app.ashbyhq.com/w.png","logoSquareImageUrl":null}`) === "https://app.ashbyhq.com/w.png"],
  ["no logo marked: null (og:image alone is not used)", logoFromHtml("greenhouse", `<meta property="og:image" content="https://x/y.png"/><img src="https://x/z.png">`) === null],
  ["http (not https) is refused", logoFromHtml("greenhouse", `<img class="logo" src="http://x/y.png">`) === null],
  ["entities are decoded", logoFromHtml("greenhouse", `<img class="logo" src="https://x/y.png?a=1&amp;b=2">`) === "https://x/y.png?a=1&b=2"],
  // 18 Nov: Workable and Zoho Recruit name the account logo as the og:image.
  ["workable: the account logo og:image", logoFromHtml("workable", `<meta property="og:image" content="https://workablehr.s3.amazonaws.com/uploads/account/open_graph_logo/491209/social?1779787723000">`) === "https://workablehr.s3.amazonaws.com/uploads/account/open_graph_logo/491209/social?1779787723000"],
  ["workable: Workable's own default image is not a logo", logoFromHtml("workable", `<meta property="og:image" content="https://www.workable.com/static/default-share.png">`) === null],
  ["zoho: the career site's company logo", logoFromHtml("zohorecruit", `<meta property="og:image" content="https://artingdigital.zohorecruit.in/recruit/viewCareerImage.do?type=meta&amp;page_id=1&amp;file_name=company_logo.jpg">`) === "https://artingdigital.zohorecruit.in/recruit/viewCareerImage.do?type=meta&page_id=1&file_name=company_logo.jpg"],
  ["smartrecruiters: the social og:image is not the logo", logoFromHtml("smartrecruiters", `<meta property="og:image" content="https://c.smartrecruiters.com/sr-company-images-prod-aws-dc5/5865/default_social_logo/300x300">`) === null],
  // 18 Nov: SmartRecruiters' logo from a job page, Workday's fixed address, Workable's account API.
  ["smartrecruiters: the company logo on a job page", logoFromHtml("smartrecruiters", `<img src="https://c.smartrecruiters.com/sr-company-images-prod-aws-dc5/5865/default_social_logo/300x300?r=s3&amp;_1" /><img src="https://c.smartrecruiters.com/sr-company-logo-prod-aws-dc5/5865/huge?r=s3-eu-central-1&amp;_17" alt="Bosch Group logo">`) === "https://c.smartrecruiters.com/sr-company-logo-prod-aws-dc5/5865/huge?r=s3-eu-central-1&_17"],
  ["workday: the career site's logo address", workdayLogoUrl("cw.wd1/External") === "https://cw.wd1.myworkdayjobs.com/External/assets/logo"],
  ["workday: a slug that is not tenant.wdN/site gives none", workdayLogoUrl("cigna") === null],
  ["workable: the account API's logo", logoFromHtml("workable", `{"id":691818,"logo":"https://workablehr.s3.amazonaws.com/uploads/account/logo/691818/logo","subdomain":"weekday-1","url":"https://www.weekday.works"}`) === "https://workablehr.s3.amazonaws.com/uploads/account/logo/691818/logo"],
  ["workable: the account API's website", websiteFromHtml("workable", `{"id":1,"logo":null,"url":"https://www.angloeastern.com/"}`) === "angloeastern.com"],
  // 18 Nov: the website from the company's own job links (Greenhouse boards on its careers page).
  ["own site: GLG's job links on glginsights.com, not the board host", ownSiteOf(["boards.greenhouse.io", "glginsights.com"], "GLG", "gersonlehrmangroup") === "glginsights.com"],
  ["own site: a subdomain gives the registrable domain", ownSiteOf(["cclfg.cclgroup.com"], "Connor, Clark & Lunn Financial Group Ltd.", "cclfg") === "cclgroup.com"],
  ["own site: Axiom Talent Platform on axiomlaw.com", ownSiteOf(["www.axiomlaw.com"], "Axiom Talent Platform", "axiomtalentplatform") === "axiomlaw.com"],
  ["own site: only board hosts gives none", ownSiteOf(["job-boards.greenhouse.io", "boards.greenhouse.io"], "Razorpay", "razorpaysoftwareprivatelimited") === null],
  ["own site: a host named unlike the company gives none", ownSiteOf(["jobs.talentbridge.com"], "Acme Robotics", "acmerobotics") === null],
  ["site root keeps a country's second level", siteRoot("careers.acme.co.uk") === "acme.co.uk" && siteRoot("www.c3.ai") === "c3.ai"],
  // 18 Nov: legal-name slugs, a name two companies share, and a distinctive name Clearbit gives a tagline for.
  ["a legal-name slug still matches (razorpaysoftwareprivatelimited → razorpay.com)", sure(domainCandidates([{ name: "Razorpay", domain: "razorpay.com" }, { name: "Razorpay", domain: "razorpaycurlec.com" }, { name: "Razorpay", domain: "razorpayx.site" }, { name: "Razorpay", domain: "payrollfixed.com" }], "Razorpay", "razorpaysoftwareprivatelimited"))[0] === "razorpay.com"],
  ["two companies named Orion Innovation: neither domain is sure", sure(domainCandidates([{ name: "Orion Innovation", domain: "orioninc.com" }, { name: "Orion Innovations P.C", domain: "orioninnovations.gr" }, { name: "Orion Innovation", domain: "orioninnovation.nl" }], "Orion Innovation", "orioninnovation")).length === 0],
  ["Anblicks: name, slug and domain the same distinctive word", sure(domainCandidates([{ name: "Unleash Your Data", domain: "anblicks.com" }], "Anblicks", "anblicks"))[0] === "anblicks.com"],
  ["a plain guess is never sure on its own", sure(domainCandidates([{ domain: "anblicks.com" }], "Anblicks", "anblicks")).length === 0],
  ["Gradient: two owners of one name stay unsure", sure(domainCandidates([{ name: "Gradient Ventures", domain: "gradient.com" }, { name: "Gradient", domain: "gradient.co.me" }], "Gradient", "gradient")).length === 0],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}
console.log(failed === 0 ? "PASS logos" : `FAIL logos (${failed})`);
process.exit(failed === 0 ? 0 : 1);
