import { NextResponse } from "next/server";
import { mockFormEnabled } from "@/lib/mock-gate";
import { mockRespondReply } from "../../../../../mock";

// The mock Naukri chat bot (K4b): takes each answer; the page itself shows the next question.
export function POST() {
  if (!mockFormEnabled()) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(mockRespondReply());
}
