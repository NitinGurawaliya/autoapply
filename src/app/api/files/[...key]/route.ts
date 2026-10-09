import { auth } from "@/lib/auth";
import { storage } from "@/lib/storage";

type RouteContext = { params: Promise<{ key: string[] }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { key: parts } = await context.params;
  const key = parts.map(decodeURIComponent).join("/");
  const file = await storage.get(key);
  if (!file || file.userId !== session.user.id) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      // Personal documents: never cached by a shared cache, never sniffed into another type, never run as a page.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
