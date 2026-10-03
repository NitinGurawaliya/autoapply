"use client";

export default function FeedError() {
  return (
    <main className="mx-auto w-full max-w-[480px] px-4 py-8">
      <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
        Could not load the feed.
      </p>
    </main>
  );
}
