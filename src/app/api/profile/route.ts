import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forgetFeed } from "@/lib/feed-cache";
import { profileSchema } from "@/modules/profile";

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
  const parsed = profileSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const existing = await db.profile.findUnique({ where: { userId: user.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const profile = parsed.data;
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
    },
  });
  forgetFeed(user.id); // title, skills and years decide the feed's scores
  return NextResponse.json(toJson(updated));
}
