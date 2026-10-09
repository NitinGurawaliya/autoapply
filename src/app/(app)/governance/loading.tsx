export default function GovernanceLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading governance">
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      {[0, 1, 2].map((n) => (
        <div key={n} className="h-16 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
