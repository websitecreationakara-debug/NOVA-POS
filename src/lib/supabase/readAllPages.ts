// Every row of a query, read in parallel pages of 1000 (the database's per-request
// cap). The first 8 pages are asked for at once -- enough for most tables, so no
// separate count round trip comes first (a page past the end comes back as
// PostgREST's "range not satisfiable" error, which just means no more rows) -- and
// if the first page's exact count says there are more, the rest are asked for
// together. Only the first page asks for the (costly) exact count.
//
// The query needs a stable .order(), and is rebuilt per page (range() mutates it):
// `makeQuery(withCount)` must add { count: "exact" } to its select when told to.
export async function readAllPages<T>(
  makeQuery: (withCount: boolean) => {
    range(
      from: number,
      to: number
    ): PromiseLike<{ data: unknown[] | null; count: number | null; error: { message: string; code?: string } | null }>;
  }
): Promise<T[]> {
  const PAGE = 1000;
  const FIRST = 8;
  const fetchPages = (from: number, to: number) =>
    Promise.all(
      Array.from({ length: to - from }, (_, i) =>
        makeQuery(from + i === 0).range((from + i) * PAGE, (from + i) * PAGE + PAGE - 1)
      )
    );
  const out: T[] = [];
  const take = (pages: Awaited<ReturnType<typeof fetchPages>>) => {
    for (const page of pages) {
      if (page.error?.code === "PGRST103") continue;
      if (page.error) throw new Error(page.error.message);
      out.push(...((page.data ?? []) as T[]));
    }
  };
  const first = await fetchPages(0, FIRST);
  take(first);
  const total = Math.ceil((first[0].count ?? 0) / PAGE);
  if (total > FIRST) take(await fetchPages(FIRST, total));
  return out;
}
