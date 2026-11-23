"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SignInStream } from "@/app/(app)/account/sign-in-stream";

// The streamed sign-in sheet (K8) in each of its states, with the pass and the worker's stream played by a stand-in
// fetch for "demo" only: a drawn page instead of a real one, nothing leaves the page.

type Scenario = "live" | "loading" | "connected" | "expired" | "error";
let scenario: Scenario = "live";
let installed = false;
// Set once the connected scenario's stream ends: the pass then says connected, as the server would.
let ended = false;

/** A plain sign-in page, drawn: what a frame looks like. */
function drawFrame(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const g = canvas.getContext("2d")!;
  g.scale(2, 2);
  g.fillStyle = "white";
  g.fillRect(0, 0, width, height);
  g.fillStyle = "black";
  g.font = "600 22px sans-serif";
  g.fillText("Login", 20, 56);
  g.font = "15px sans-serif";
  for (const [index, label] of ["Email ID / Username", "Password"].entries()) {
    const top = 90 + index * 84;
    g.fillStyle = "dimgray";
    g.fillText(label, 20, top);
    g.strokeStyle = "silver";
    g.strokeRect(20, top + 10, width - 40, 44);
  }
  g.fillStyle = "royalblue";
  g.fillRect(20, 270, width - 40, 44);
  g.fillStyle = "white";
  g.fillText("Login", width / 2 - 18, 297);
  return canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
}

function sse(events: Array<[string, unknown]>, delayMs: number, then?: () => void) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [name, data] of events) {
        controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      then?.();
      controller.close();
    },
  });
}

function install() {
  if (installed) return;
  installed = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/sources/demo/stream")) {
      if (scenario === "loading") return json({ state: "waiting" });
      if (scenario === "expired") return json({ state: "ended", status: "failed", accountLabel: null, lastError: "Signing in took longer than 10 minutes. Connect again when you are ready." });
      if (ended) return json({ state: "ended", status: "connected", accountLabel: "Asha", lastError: null });
      return json({ state: "ready", url: "https://relay.demo/stream/DEMO0000000000000000", token: "demo", expiresAt: new Date(Date.now() + 600_000).toISOString() });
    }
    if (url.startsWith("https://relay.demo/")) {
      if (url.includes("/input")) return new Response(null, { status: 204 });
      if (scenario === "error") throw new TypeError("demo: unreachable");
      ended = false;
      const size = new URL(url).searchParams;
      const width = Number(size.get("w")) || 350;
      const height = Number(size.get("h")) || 560;
      const frame = { d: drawFrame(width, height), w: width, h: height };
      const events: Array<[string, unknown]> = [["open", {}], ...Array.from({ length: scenario === "connected" ? 4 : 600 }, (): [string, unknown] => ["frame", frame])];
      if (scenario === "connected") events.push(["end", { outcome: "connected" }]);
      return new Response(sse(events, 500, () => (ended = scenario === "connected")), { headers: { "Content-Type": "text/event-stream" } });
    }
    return real(input, init);
  };
}

export function SignInStreamDemo() {
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(install, []);
  return (
    <div className="flex flex-wrap gap-2">
      {(["live", "loading", "connected", "expired", "error"] as const).map((name) => (
        <Sheet key={name} open={open && scenario === name} onOpenChange={setOpen}>
          <SheetTrigger
            render={<Button variant="line" size="md" />}
            onClick={() => {
              scenario = name;
              ended = false;
              setRun((count) => count + 1);
              setOpen(true);
            }}
          >
            {name}
          </SheetTrigger>
          <SheetContent aria-label="Sign in to Naukri">
            <SignInStream key={run} site="demo" label="Naukri" onSettled={() => undefined} onClose={() => setOpen(false)} onCancel={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      ))}
    </div>
  );
}
