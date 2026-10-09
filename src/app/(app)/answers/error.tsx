"use client";

export default function AnswersError({ reset }: { reset: () => void }) {
  return (
    <div>
      <p className="text-sm text-destructive">Could not load your saved answers.</p>
      <button type="button" onClick={reset} className="mt-3 rounded-full border border-border px-3 py-1 text-xs">
        Try again
      </button>
    </div>
  );
}
