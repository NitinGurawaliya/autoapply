import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { mockFormEnabled } from "@/lib/mock-gate";
import { mockPayloadSchema } from "@/app/mock/schema";
import { z } from "zod";

const naukriPayloadSchema = z.object({ site: z.literal("naukri"), jobId: z.string(), answers: z.array(z.string()) });

export default async function MockSubmissionsPage() {
  if (!mockFormEnabled()) notFound();
  const rows = await db.mockSubmission.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Submissions</h1>
        <p className="mt-1 text-sm text-muted-foreground">Mock Greenhouse and mock Naukri payloads</p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-sm text-muted-foreground">
          No submissions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => {
            // The mock Naukri drawer's answers (K4b) sit in the same table; a Greenhouse payload is the rest.
            const naukri = naukriPayloadSchema.safeParse(row.payload);
            if (naukri.success) {
              return (
                <li key={row.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">Mock Naukri: job {naukri.data.jobId}</p>
                  <ol className="mt-3 list-decimal pl-5">
                    {naukri.data.answers.map((answer, index) => (
                      <li key={index} className="break-all">{answer}</li>
                    ))}
                  </ol>
                </li>
              );
            }
            const parsed = mockPayloadSchema.safeParse(row.payload);
            if (!parsed.success) return null;
            const payload = parsed.data;
            return (
              <li key={row.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">Resume file: {payload.resumeFileName}</p>
                <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1">
                  {Object.entries(payload).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="break-all">{typeof value === "string" ? value : `${value.name} (${value.bytes} bytes)`}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
