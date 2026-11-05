import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { mockFormEnabled } from "@/lib/mock-gate";
import { mockApplyReply } from "../../../../../mock";

// The mock Naukri apply service (K4b): the first press opens the drawer, the press after its last answer applies and is
// recorded as a MockSubmission (shown on /mock/submissions). ?refuse=1 answers as Naukri does when it wants a reCAPTCHA.
const bodySchema = z.object({
  strJobsarr: z.array(z.string().max(80)).max(5).optional(),
  applyData: z.object({ answers: z.array(z.string().max(2000)).max(30).optional() }).optional(),
});

export async function POST(req: Request) {
  // An anonymous endpoint that writes to the database: only where the mock form is meant to exist.
  if (!mockFormEnabled()) return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.get("refuse") === "1") return NextResponse.json({ message: "recaptcha required" }, { status: 406 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const reply = mockApplyReply(parsed.data, url.searchParams.get("instant") === "1");
  if (parsed.data.applyData || url.searchParams.get("instant") === "1") {
    await db.mockSubmission.create({ data: { payload: { site: "naukri", jobId: reply.jobs[0].jobId, answers: parsed.data.applyData?.answers ?? [] } } });
  }
  return NextResponse.json(reply);
}
