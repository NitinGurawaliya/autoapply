// A board account's website and name from its board's page, and which domains count as an employer's own
// (modules/jobs/company-facts.ts, domains.ts; docs/employers/TDD.md W2). Page snippets copied from the live pages on
// 27 Nov 2026 (ramp on Ashby, huggingface on Workable, cred on Lever, Bosch Group on SmartRecruiters, accredian on Keka,
// Arting Digital on Zoho Recruit, anthropic on Greenhouse). No network, no database writes.
//   npx tsx scripts/company-facts-test.ts
import { employerDomain, isGenericCompanyName } from "../src/modules/jobs/domains";
import { nameFromBoardPage, websiteFromBoardPage } from "../src/modules/jobs/company-facts";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const eq = (name: string, got: unknown, want: unknown) => ok(name, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ashby = `ceMode":false,"organization":{"organizationId":"7a158cac-9866-4881-95a8-bc946d3dca79","name":"Ramp","publicWebsite":"https://ramp.com","customJobsPageUrl":null,"hostedJobsPageSlug":"ramp"`;
const workable = `{"id":514327,"uid":"940cf17f","logo":"https://workablehr.s3.amazonaws.com/uploads/account/logo/514327/logo","subdomain":"huggingface","name":"Hugging Face","url":"https://huggingface.co/","languages":{"default":"en","options":[{"enabled":true,"name":"en","published":true}]}}`;
const lever = `<style>.main-footer-text {background: #edeef1;text-align: center;}</style><div class="main-footer"><div class="main-footer-text"><p><a href="https://www.cred.club/">CRED Home Page</a></p><div class="mt1"><p>We may use AI tools.</p></div></div></div><title>CRED</title>`;
const smartrecruiters = `<header class="jobad-header"><span class="header-logo logo"><a href="https://www.bosch.com/" target="newtab" rel="nofollow noopener" title="Bosch Group"><img src="https://c.smartrecruiters.com/sr-company-logo-prod-aws-dc5/58652035/huge?r=s3&amp;_1" alt="Bosch Group logo"></a></span></header>`;
const keka = `{"name":"Accredian","logoPath":"orglogo/9ca0.png","careersBackgroundPath":"","shortName":"Accredian","careersPortalDomain":"accredian.keka.com","companyWebsite":"https://www.accredian.com","socialLinks":[{"type":1,"url":"https://www.linkedin.com/school/accredianedu/"}]}`;
const zoho = `<meta property="og:site_name" content="Arting Digital Private Limited"><input type="hidden" value="{&#34;org_info&#34;:{&#34;mode&#34;:1,&#34;website&#34;:&#34;artingdigital.com&#34;,&#34;public_description&#34;:false,&#34;company_name&#34;:&#34;Arting Digital Private Limited&#34;,&#34;id&#34;:&#34;107457000000279512&#34;,&#34;type&#34;:&#34;staffing&#34;,&#34;hide_company_name&#34;:false,&#34;hide_visit_website&#34;:false},&#34;page_id&#34;:&#34;1&#34;}"><meta property="og:type" content="website">`;
const greenhouse = `boardConfiguration":{"job_board_id":4000403008,"logo":{"href":"https://www.anthropic.com/jobs","url":"https://s8-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/040/300/original/x.png?1"},"filters":{"include_office_filter":true}}`;

// The website each board names.
eq("ashby: publicWebsite", websiteFromBoardPage("ashby", ashby), "https://ramp.com");
eq("workable: the account's url", websiteFromBoardPage("workable", workable), "https://huggingface.co/");
eq("lever: the footer Home Page link, not the style rule", websiteFromBoardPage("lever", lever), "https://www.cred.club/");
eq("smartrecruiters: the header logo link", websiteFromBoardPage("smartrecruiters", smartrecruiters), "https://www.bosch.com/");
eq("keka: companyWebsite", websiteFromBoardPage("keka", keka), "https://www.accredian.com");
eq("zoho: org_info.website, entities decoded (not the og:type 'website')", websiteFromBoardPage("zohorecruit", zoho), "artingdigital.com");
eq("greenhouse: the logo's href", websiteFromBoardPage("greenhouse", greenhouse), "https://www.anthropic.com/jobs");
eq("workday names none", websiteFromBoardPage("workday", "{}"), null);
eq("ashby: no field, null", websiteFromBoardPage("ashby", `{"organization":{"name":"X","publicWebsite":null}}`), null);
eq("keka: empty companyWebsite, null", websiteFromBoardPage("keka", `{"name":"Techdome","companyWebsite":""}`), null);
eq("keka: no companyWebsite key, null", websiteFromBoardPage("keka", `{"name":"Jupiter"}`), null);
eq("greenhouse: no logo link, null", websiteFromBoardPage("greenhouse", `boardConfiguration":{"job_board_id":1,"logo":{"href":null,"url":"https://x/y.png"}}`), null);
eq("lever: no footer link, null", websiteFromBoardPage("lever", `<div class="main-footer-text"><div>no link</div></div>`), null);
eq("an empty page, null", websiteFromBoardPage("lever", ""), null);
eq("zoho: a portal that hides its website, null", websiteFromBoardPage("zohorecruit", zoho.replace("hide_visit_website&#34;:false", "hide_visit_website&#34;:true")), null);

// The name each board gives.
eq("workable: name", nameFromBoardPage("workable", workable), "Hugging Face");
eq("keka: name", nameFromBoardPage("keka", keka), "Accredian");
eq("lever: the footer link without 'Home Page'", nameFromBoardPage("lever", lever), "CRED");
eq("lever: no footer, the page title", nameFromBoardPage("lever", `<title>Acme</title>`), "Acme");
eq("smartrecruiters: the logo link's title", nameFromBoardPage("smartrecruiters", smartrecruiters), "Bosch Group");
eq("zoho: org_info.company_name", nameFromBoardPage("zohorecruit", zoho), "Arting Digital Private Limited");
eq("zoho: og:site_name when org_info has none", nameFromBoardPage("zohorecruit", `<meta property="og:site_name" content="Zenatta Consulting">`), "Zenatta Consulting");
eq("zoho: a portal that hides its name, null", nameFromBoardPage("zohorecruit", zoho.replace("hide_company_name&#34;:false", "hide_company_name&#34;:true")), null);
eq("ashby has no name field here", nameFromBoardPage("ashby", ashby), null);

// Which address is an employer's own.
eq("a full address", employerDomain("https://www.Razorpay.com/careers"), "razorpay.com");
eq("a careers subdomain is dropped", employerDomain("careers.toddleapp.com"), "toddleapp.com");
eq("a country domain stays whole", employerDomain("acme.co.uk/x"), "acme.co.uk");
eq("a shared host keeps its own label", employerDomain("foo.github.io"), "foo.github.io");
eq("the board's own website with a trailing slash", employerDomain("https://huggingface.co/"), "huggingface.co");
eq("a bare domain from Zoho", employerDomain("artingdigital.com"), "artingdigital.com");
eq("linkedin is not an employer", employerDomain("linkedin.com/company/x"), null);
eq("an ATS is not an employer", employerDomain("jobs.lever.co/x"), null);
eq("a mail host is not an employer", employerDomain("gmail.com"), null);
eq("an IP address", employerDomain("10.0.0.1"), null);
eq("a host without a dot", employerDomain("localhost"), null);
eq("empty", employerDomain(""), null);
eq("null", employerDomain(null), null);
eq("a mailto-looking value", employerDomain("not a url at all"), null);
eq("sites.google.com is refused", employerDomain("sites.google.com/view/acme"), null);

// Generic board names.
eq("Careers is generic", isGenericCompanyName("Careers"), true);
eq("' jobs ' is generic", isGenericCompanyName(" jobs "), true);
eq("empty is generic", isGenericCompanyName(""), true);
eq("Careem is not", isGenericCompanyName("Careem"), false);
eq("Careers Hub Ltd is not", isGenericCompanyName("Careers Hub Ltd"), false);

console.log(failed === 0 ? "PASS company-facts-test" : `FAIL company-facts-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
