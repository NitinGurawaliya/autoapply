import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mockPayloadSchema } from "@/app/mock/schema";

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const form = await req.formData();
  const resume = form.get("resume");
  const resumeFileName = resume instanceof File && resume.size > 0 ? resume.name : "";
  const parsed = mockPayloadSchema.safeParse({
    first_name: text(form, "first_name"),
    last_name: text(form, "last_name"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    how_heard: text(form, "how_heard"),
    notice_period: text(form, "notice_period"),
    work_authorization: text(form, "work_authorization"),
    free_text: text(form, "free_text"),
    gender: text(form, "gender"),
    race: text(form, "race"),
    veteran_status: text(form, "veteran_status"),
    disability: text(form, "disability"),
    resumeFileName,
  });

  const back = new URL("/mock/greenhouse", req.url);
  if (!parsed.success) {
    back.searchParams.set("error", resumeFileName ? "fields" : "resume");
    return NextResponse.redirect(back, 303);
  }

  await db.mockSubmission.create({
    data: { payload: parsed.data as Prisma.InputJsonValue },
  });

  return NextResponse.redirect(new URL("/mock/submissions", req.url), 303);
}
