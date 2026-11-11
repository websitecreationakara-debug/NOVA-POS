// What Reorder Suggestions shows while its figures are still being worked out: the real title straight away, with
// placeholders where the cards and the table will be (the page streams the rest in when it is ready).
export default function ReorderSkeleton() {
  const block = "animate-pulse rounded-2xl border border-border bg-muted/50";
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Reorder Suggestions</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          What to buy so you never run short for your customers, worked out from the last 90 days of sales.
        </p>
        <p className="text-xs text-muted-foreground">Working out your stock…</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${block} h-[108px]`} />
        ))}
      </div>
      <div className={`${block} h-24`} />
      <div className={`${block} h-96`} />
    </div>
  );
}
