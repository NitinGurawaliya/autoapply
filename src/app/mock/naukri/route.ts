import { mockFormEnabled } from "@/lib/mock-gate";
import { mockNaukriHtml } from "./mock";

// The mock Naukri job page (K4b): test profiles and automated tests apply here instead of Naukri. Off in production
// unless ENABLE_MOCK_FORM=1, as the mock Greenhouse form (lib/mock-gate.ts, proxy.ts).
export function GET(req: Request) {
  if (!mockFormEnabled()) return new Response("Not found", { status: 404 });
  const jobId = (new URL(req.url).searchParams.get("job") ?? "mock").replace(/[^\w-]/g, "").slice(0, 60) || "mock";
  return new Response(mockNaukriHtml({ jobId, services: "/mock/naukri" }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
