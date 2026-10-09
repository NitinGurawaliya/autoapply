export default function AccountLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your account">
      {[0, 1].map((n) => (
        <div key={n} className="h-28 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}
