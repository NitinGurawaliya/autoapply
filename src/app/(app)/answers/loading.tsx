export default function AnswersLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your answers">
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className="h-20 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
