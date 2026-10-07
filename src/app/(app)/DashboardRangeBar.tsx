"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ALL_BUSINESSES_ID } from "@/lib/supabase/queries";
import type { RangeMode } from "@/lib/dateRange";

// Same Day/Week/Month/Quarter/Year picker as the Accountance page
// (src/app/(app)/accountance/AccountanceClient.tsx), plus a business chip row
// (All Business + each real brand) -- same ALL_BUSINESSES_ID sentinel and
// "no brand param = All Business" convention as that page's own dropdown.
//
// It can also run as a second, separate filter for one part of the dashboard
// (the Top Branch / Top Products cards): `paramPrefix` ("top_") keeps its range
// in its own URL params so it never touches the page-wide one, and
// `showBrands={false}` leaves out the business chips (those stay the page's).
export default function DashboardRangeBar({
  brands,
  brandId,
  paramPrefix = "",
  showBrands = true,
  mode,
  week,
  month,
  quarter,
  year,
  fromDate,
  toDate,
}: {
  brands: { id: string; name: string }[];
  brandId: string;
  paramPrefix?: string;
  showBrands?: boolean;
  mode: RangeMode;
  week: string;
  month: string;
  quarter: string;
  year: string;
  fromDate: string;
  toDate: string;
}) {
  const router = useRouter();
  const [showRangeEnd, setShowRangeEnd] = useState(fromDate !== toDate);

  function urlFor(overrides: {
    brand?: string;
    mode?: RangeMode;
    from?: string;
    to?: string;
    week?: string;
    month?: string;
    quarter?: string;
    year?: string;
  }) {
    const targetMode = overrides.mode ?? mode;
    // Start from the current URL so the OTHER filter's params survive; only this
    // bar's own (prefixed) params are rewritten.
    const params = new URLSearchParams(window.location.search);
    const key = (k: string) => `${paramPrefix}${k}`;
    for (const k of ["mode", "week", "month", "quarter", "year", "from", "to"]) params.delete(key(k));
    if (!paramPrefix) params.set("brand", overrides.brand ?? brandId);
    params.set(key("mode"), targetMode);
    if (targetMode === "week") params.set(key("week"), overrides.week ?? week);
    else if (targetMode === "month")
      params.set(key("month"), overrides.month ?? month);
    else if (targetMode === "quarter")
      params.set(key("quarter"), overrides.quarter ?? quarter);
    else if (targetMode === "year") params.set(key("year"), overrides.year ?? year);
    else {
      params.set(key("from"), overrides.from ?? fromDate);
      params.set(key("to"), overrides.to ?? toDate);
    }
    return `/?${params.toString()}`;
  }

  // First visit to a bare "/" -> put the range actually in effect (business + mode +
  // dates) in the address, so it can be reloaded or shared as is. No refetch, no
  // history entry. Only the page-wide bar: the "top_" bar must not switch its
  // own filter on just by existing.
  useEffect(() => {
    if (paramPrefix) return;
    const target = urlFor({});
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(window.history.state, "", target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramPrefix, brandId, mode, week, month, quarter, year, fromDate, toDate]);

  function switchBrand(newBrandId: string) {
    router.push(urlFor({ brand: newBrandId }), { scroll: false });
  }

  function switchMode(newMode: RangeMode) {
    router.push(urlFor({ mode: newMode }), { scroll: false });
  }

  function switchDates(newFrom: string, newTo: string) {
    router.push(urlFor({ mode: "day", from: newFrom, to: newTo }), { scroll: false });
  }

  function switchWeek(newWeek: string) {
    router.push(urlFor({ mode: "week", week: newWeek }), { scroll: false });
  }

  function stepWeek(delta: number) {
    const d = new Date(`${week}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 7 * delta);
    switchWeek(d.toISOString().slice(0, 10));
  }

  function switchMonth(newMonth: string) {
    router.push(urlFor({ mode: "month", month: newMonth }), { scroll: false });
  }

  function stepMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    switchMonth(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }

  function switchQuarter(newQuarter: string) {
    router.push(urlFor({ mode: "quarter", quarter: newQuarter }), { scroll: false });
  }

  function stepQuarter(delta: number) {
    const [y, q] = quarter.split("-Q").map(Number);
    const zeroBased = q - 1 + delta;
    const yearOffset = Math.floor(zeroBased / 4);
    const newQ = ((zeroBased % 4) + 4) % 4;
    switchQuarter(`${y + yearOffset}-Q${newQ + 1}`);
  }

  function switchYear(newYear: string) {
    router.push(urlFor({ mode: "year", year: newYear }), { scroll: false });
  }

  function stepYear(delta: number) {
    switchYear(String(Number(year) + delta));
  }

  return (
    <>
      {showBrands && (
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => switchBrand(ALL_BUSINESSES_ID)}
          aria-pressed={brandId === ALL_BUSINESSES_ID}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
            brandId === ALL_BUSINESSES_ID
              ? "border-brand bg-brand text-white"
              : "border-border bg-muted/60 text-muted-foreground hover:text-foreground"
          }`}
        >
          All Business
        </button>
        {brands.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => switchBrand(b.id)}
            aria-pressed={brandId === b.id}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              brandId === b.id
                ? "border-brand bg-brand text-white"
                : "border-border bg-muted/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>
      )}

      <div className={`${showBrands ? "mt-3" : ""} flex flex-wrap items-center gap-3 rounded-lg border border-black/[.08] p-3 dark:border-white/[.145]`}>
        <div className="inline-flex rounded-full border border-black/[.15] p-0.5 dark:border-white/[.2]">
          {(["day", "week", "month", "quarter", "year"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                mode === m
                  ? "bg-brand text-white"
                  : "text-zinc-500 hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "day" && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={fromDate}
              max={showRangeEnd ? toDate : undefined}
              onChange={(e) =>
                switchDates(
                  e.target.value,
                  showRangeEnd ? toDate : e.target.value,
                )
              }
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            {showRangeEnd ? (
              <>
                <span className="text-xs text-zinc-500">to</span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => switchDates(fromDate, e.target.value)}
                  className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowRangeEnd(false);
                    switchDates(fromDate, fromDate);
                  }}
                  aria-label="Remove end date"
                  className="text-zinc-500 hover:text-foreground"
                >
                  ×
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowRangeEnd(true)}
                className="text-xs font-medium text-brand hover:underline"
              >
                + Range
              </button>
            )}
          </div>
        )}

        {mode === "week" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepWeek(-1)}
              aria-label="Previous week"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-40 text-center text-sm">
              {fromDate} – {toDate}
            </span>
            <button
              type="button"
              onClick={() => stepWeek(1)}
              aria-label="Next week"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {mode === "month" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="Previous month"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => switchMonth(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="Next month"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {mode === "quarter" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepQuarter(-1)}
              aria-label="Previous quarter"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-20 text-center text-sm">{quarter}</span>
            <button
              type="button"
              onClick={() => stepQuarter(1)}
              aria-label="Next quarter"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {mode === "year" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepYear(-1)}
              aria-label="Previous year"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <input
              type="number"
              inputMode="numeric"
              value={year}
              onChange={(e) => switchYear(e.target.value)}
              className="w-20 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <button
              type="button"
              onClick={() => stepYear(1)}
              aria-label="Next year"
              className="rounded-full p-1 text-zinc-500 hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.1]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
