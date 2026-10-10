import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { applicationVersion } from "@/lib/status-meta";

const fieldsSchema = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    value: z.string(),
    source: z.string(),
    selector: z.string(),
  }),
);

const pendingSchema = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.string(),
    options: z.array(z.string()).optional(),
    required: z.boolean(),
  }),
);

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  // What the detail page polls while a run is going (components/auto-refresh.tsx): one small query, not the page.
  if (new URL(req.url).searchParams.get("only") === "version") {
    const found = await db.application.findFirst({ where: { id, userId: user.id }, select: { status: true, _count: { select: { events: true } } } });
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ version: applicationVersion(found.status, found._count.events) }, { headers: { "Cache-Control": "no-store" } });
  }
  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const job = await db.job.findUnique({
    where: { id: application.jobId },
    select: { title: true, location: true, applyUrl: true, company: { select: { name: true } } },
  });

  return NextResponse.json({
    id: application.id,
    jobId: application.jobId,
    title: job?.title ?? "Unknown role",
    company: job?.company.name ?? "Unknown company",
    location: job?.location ?? "",
    applyUrl: job?.applyUrl ?? null,
    createdAt: application.createdAt,
    status: application.status,
    error: application.error,
    attempt: application.attempt,
    screenshotKey: application.screenshotKey,
    submittedAt: application.submittedAt,
    fields: fieldsSchema.parse(application.fields),
    pendingQuestions: pendingSchema.parse(application.pendingQuestions),
    events: application.events.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      rule: event.rule,
      createdAt: event.createdAt,
    })),
  });
}
