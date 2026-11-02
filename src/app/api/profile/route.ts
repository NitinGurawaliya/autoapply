import { Prisma } from "@prisma/client";
import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forgetFeed } from "@/lib/feed-cache";
import { enqueuePrescan } from "@/lib/queue";
import { TRACKS } from "@/modules/jobs";
import { upsert } from "@/modules/answers";
import { profileSchema, resumeAnswers } from "@/modules/profile";

/** The details resumeAnswers reads, from a stored profile. */
function pick(row: { fullName: string; email: string; phone: string | null; city: string | null; country: string | null; linkedin: string | null; github: string | null; portfolio: string | null; yearsExperience: number | null; currentTitle: string | null; currentCompany: string | null }) {
  const { fullName, email, phone, city, country, linkedin, github, portfolio, yearsExperience, currentTitle, currentCompany } = row;
  return { fullName, email, phone, city, country, linkedin, github, portfolio, yearsExperience, currentTitle, currentCompany };
}

function toJson(profile: {
  fullName: string;
  email: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  yearsExperience: number | null;
  currentTitle: string | null;
  currentCompany: string | null;
  skills: unknown;
  experience: unknown;
  education: unknown;
}) {
  return {
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    city: profile.city,
    country: profile.country,
    linkedin: profile.linkedin,
    github: profile.github,
    portfolio: profile.portfolio,
    yearsExperience: profile.yearsExperience,
    currentTitle: profile.currentTitle,
    currentCompany: profile.currentCompany,
    skills: profile.skills,
    experience: profile.experience,
    education: profile.education,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const profile = await db.profile.findUnique({ where: { userId: user.id } });
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(toJson(profile));
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const existing = await db.profile.findUnique({ where: { userId: user.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const profile = parsed.data;
  // The fields the user confirmed (onboarding); only known tracks, and only when the form sent them.
  const tracks = Array.isArray(raw?.tracks) ? [...new Set((raw.tracks as unknown[]).filter((t): t is string => typeof t === "string" && (TRACKS as readonly string[]).includes(t)))] : null;
  const updated = await db.profile.update({
    where: { userId: user.id },
    data: {
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      city: profile.city,
      country: profile.country,
      linkedin: profile.linkedin,
      github: profile.github,
      portfolio: profile.portfolio,
      yearsExperience: profile.yearsExperience,
      currentTitle: profile.currentTitle,
      currentCompany: profile.currentCompany,
      skills: profile.skills as Prisma.InputJsonValue,
      experience: profile.experience as Prisma.InputJsonValue,
      education: profile.education as Prisma.InputJsonValue,
      ...(tracks ? { tracks } : {}),
    },
  });
  // A detail the user changed on the review screen is their answer now (forms read answers, not the profile). Only
  // the changed ones: the others keep their source, and the user's saved answers are never sent back (2 Nov).
  const before = new Map(resumeAnswers({ ...profile, ...pick(existing) }).map((row) => [row.key, row.answer]));
  for (const row of resumeAnswers(profile)) {
    if (before.get(row.key) !== row.answer) await upsert(user.id, { ...row, source: "user" });
  }
  forgetFeed(user.id); // title, skills and years decide the feed's scores
  // Confirmed details change the verdicts' input: build the feed again in the worker before the user gets there.
  after(() => enqueuePrescan(user.id, "profile").catch(() => undefined));
  return NextResponse.json(toJson(updated));
}
