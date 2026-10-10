// Third batch of Greenhouse candidates (10 Oct: fresher roles are scarce, 12 open in India across 98 companies).
// Indian consumer, fintech, SaaS and AI companies, and global companies with graduate or campus hiring in India;
// names already checked in batches 1 and 2 left out. Checked by `npx tsx scripts/discover-greenhouse.ts --batch 3`.
import type { Candidate } from "./greenhouse-candidates";

export const CANDIDATES_3: Candidate[] = [
  // Indian consumer internet and unicorns
  ["Moj", "midsize"], ["Dream Sports", "midsize", "dreamsports"], ["Zupee", "midsize"], ["WinZO", "midsize"], ["VerSe Innovation", "midsize", "verse"], ["FreshToHome", "midsize"],
  ["Bizongo", "midsize"], ["Bewakoof", "midsize"], ["Snitch", "midsize"], ["Livspace", "midsize"], ["HomeLane", "midsize"], ["MagicBricks", "midsize"],
  ["Cult.fit", "midsize", "cultfit"], ["CureBay", "midsize"], ["Even Healthcare", "midsize", "evenhealthcare"], ["Eka Care", "midsize", "ekacare"],
  // Indian fintech
  ["Cashfree Payments", "midsize", "cashfreepayments"], ["OneCard", "midsize"], ["OkCredit", "midsize"], ["Fampay", "midsize"], ["Scapia", "midsize"], ["Turtlemint", "midsize"],
  ["Ditto Insurance", "midsize", "ditto"], ["Plum", "midsize"], ["Onsurity", "midsize"], ["Kotak Securities", "midsize", "kotak"], ["Niyo", "midsize"], ["Volt Money", "midsize", "voltmoney"],
  // Indian SaaS and AI
  ["Zoho", "midsize"], ["Keka", "midsize"], ["SpotDraft", "midsize"], ["Eightfold", "midsize"], ["Sarvam AI", "midsize", "sarvam"], ["Krutrim", "midsize"],
  ["Rephrase.ai", "midsize", "rephrase"], ["Wingify", "midsize"], ["Vymo", "midsize"], ["Unbxd", "midsize"], ["MathCo", "midsize"], ["Mu Sigma", "midsize", "musigma"],
  ["Sigtuple", "midsize"], ["Niramai", "midsize"], ["Increff", "midsize"], ["Zinier", "midsize"], ["Facilio", "midsize"], ["SirionLabs", "midsize"],
  ["Leena AI", "midsize", "leenaai"], ["Superops", "midsize"], ["SuperOps.ai", "midsize", "superops"], ["Recko", "midsize"], ["Knowlarity", "midsize"], ["Scaler", "midsize"],
  ["Masai School", "midsize", "masai"], ["Newton School", "midsize", "newtonschool"], ["Coding Ninjas", "midsize", "codingninjas"], ["GeeksforGeeks", "midsize"], ["Emeritus", "midsize"], ["Cuemath", "midsize"],
  ["LEAD School", "midsize", "leadschool"], ["Byju's", "midsize", "byjus"], ["Simform", "midsize"], ["Zoko", "midsize"], ["Bik.ai", "midsize", "bik"],
  // Global companies with graduate or campus hiring in India
  ["D. E. Shaw", "mnc", "deshaw"], ["Tower Research Capital", "mnc", "towerresearch"], ["Graviton", "mnc"], ["Quadeye", "mnc"], ["Optiver", "mnc"], ["IMC Trading", "mnc", "imc"],
  ["Jane Street", "mnc", "janestreet"], ["Citadel", "mnc"], ["Two Sigma", "mnc", "twosigma"], ["Arcesium", "mnc"], ["Juniper Networks", "mnc", "juniper"], ["Microchip", "mnc"],
  ["LG Soft India", "mnc", "lg"], ["Ocado", "mnc"], ["Cleartrip", "mnc"], ["Media.net", "mnc", "medianet"], ["Directi", "mnc"], ["Tekion", "mnc"],
  ["ShopBack", "mnc"], ["Carousell", "mnc"], ["EPAM", "mnc"], ["Axtria", "mnc"], ["UnitedHealth Group", "mnc", "unitedhealthgroup"], ["Siemens Healthineers", "mnc", "siemenshealthineers"],
];
