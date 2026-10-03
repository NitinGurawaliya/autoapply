import { auth } from "@/lib/auth";
import { enqueueIngest } from "@/lib/queue";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let days = 7;
  try {
    const body = (await request.json()) as { days?: unknown };
    if (body.days !== undefined) days = Number(body.days);
  } catch {
    days = 7;
  }
  if (!Number.isFinite(days) || days < 1) {
    return Response.json({ error: "days must be a positive number" }, { status: 400 });
  }

  const id = await enqueueIngest(days);
  return Response.json({ id, days });
}
