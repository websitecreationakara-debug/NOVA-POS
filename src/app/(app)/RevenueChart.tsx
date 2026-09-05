"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Range = "day" | "month" | "year";

const RANGE_LABEL: Record<Range, string> = { day: "Day", month: "Month", year: "Year" };
const UNIT: Record<Range, string> = { day: "day", month: "week", year: "month" };
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function formatTick(n: number) {
  return `$${new Intl.NumberFormat("en", { notation: "compact" }).format(n)}`;
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function mondayOf(d: Date): Date {
  const dow = d.getUTCDay(); // 0 = Sun .. 6 = Sat
  const offset = dow === 0 ? 6 : dow - 1;
  return addDays(d, -offset);
}
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function addYears(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear() + n, 0, 1));
}
function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtShort(d: Date): string {
  return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { value?: unknown; payload?: Record<string, unknown> }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg">
      <p className="text-muted-foreground">{String(point.payload?.label)}</p>
      <p className="font-semibold text-foreground">{formatMoney(Number(point.value))}</p>
    </div>
  );
}

export default function RevenueChart({
  dailyRevenue,
}: {
  dailyRevenue: { date: string; total: number }[];
}) {
  const [range, setRange] = useState<Range>("day");
  const today = useMemo(() => utcMidnight(new Date()), []);
  const [anchor, setAnchor] = useState<Date>(today);

  const dailyMap = useMemo(() => new Map(dailyRevenue.map((d) => [d.date, d.total])), [dailyRevenue]);

  const { data, periodLabel, isCurrent } = useMemo(() => {
    if (range === "day") {
      const monday = mondayOf(anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
      const points = days.map((d, i) => ({
        key: DAY_LABELS[i],
        total: dailyMap.get(toKey(d)) ?? 0,
        label: d.toLocaleDateString("en", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      }));
      const sunday = days[6];
      const label =
        monday.getUTCFullYear() === sunday.getUTCFullYear()
          ? `${fmtShort(monday)} - ${fmtShort(sunday)}, ${sunday.getUTCFullYear()}`
          : `${fmtShort(monday)}, ${monday.getUTCFullYear()} - ${fmtShort(sunday)}, ${sunday.getUTCFullYear()}`;
      return { data: points, periodLabel: label, isCurrent: monday.getTime() >= mondayOf(today).getTime() };
    }

    if (range === "month") {
      const monthStart = startOfMonth(anchor);
      const daysInMonth = new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
      ).getUTCDate();
      const bands: [number, number][] = [
        [1, 7],
        [8, 14],
        [15, 21],
        [22, daysInMonth],
      ];
      const points = bands.map(([from, to], i) => {
        let total = 0;
        for (let day = from; day <= to; day++) {
          const key = toKey(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day)));
          total += dailyMap.get(key) ?? 0;
        }
        return {
          key: `Week ${i + 1}`,
          total,
          label: `Week ${i + 1} (day ${from === to ? from : `${from}-${to}`})`,
        };
      });
      const label = monthStart.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
      return {
        data: points,
        periodLabel: label,
        isCurrent: monthStart.getTime() >= startOfMonth(today).getTime(),
      };
    }

    const yearStart = startOfYear(anchor);
    const year = yearStart.getUTCFullYear();
    const points = MONTH_LABELS.map((m, i) => {
      const prefix = `${year}-${String(i + 1).padStart(2, "0")}`;
      let total = 0;
      for (const [key, value] of dailyMap) {
        if (key.startsWith(prefix)) total += value;
      }
      return { key: m, total, label: `${m} ${year}` };
    });
    return {
      data: points,
      periodLabel: `${year}`,
      isCurrent: yearStart.getTime() >= startOfYear(today).getTime(),
    };
  }, [range, anchor, dailyMap, today]);

  // Only call out a best/worst when there's an actual spread to report --
  // an all-zero period (no sales, or none entered yet) has no "best day"
  // worth labeling.
  const { best, worst } = useMemo(() => {
    const nonZero = data.filter((d) => d.total > 0);
    if (nonZero.length < 2) return { best: null, worst: null };
    const sorted = [...nonZero].sort((a, b) => b.total - a.total);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    return { best: top, worst: top === bottom ? null : bottom };
  }, [data]);

  function step(n: number) {
    setAnchor((a) => {
      if (range === "day") return addDays(mondayOf(a), 7 * n);
      if (range === "month") return addMonths(startOfMonth(a), n);
      return addYears(startOfYear(a), n);
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold">Revenue</h2>
        <div className="flex gap-2">
          {(["day", "month", "year"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                range === r ? "bg-brand text-black" : "bg-muted text-muted-foreground"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous period"
          className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-[11rem] text-center text-sm font-medium">{periodLabel}</span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={isCurrent}
          aria-label="Next period"
          className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="size-4" />
        </button>
        {!isCurrent && (
          <button
            type="button"
            onClick={() => setAnchor(today)}
            className="ml-1 text-xs font-medium text-brand hover:underline"
          >
            Today
          </button>
        )}
      </div>

      {(best || worst) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {best && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" />
              <span className="text-muted-foreground">Best {UNIT[range]}</span>
              <span className="font-semibold text-foreground">
                {best.key} · {formatMoney(best.total)}
              </span>
            </span>
          )}
          {worst && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-warning" />
              <span className="text-muted-foreground">Slowest {UNIT[range]}</span>
              <span className="font-semibold text-foreground">
                {worst.key} · {formatMoney(worst.total)}
              </span>
            </span>
          )}
        </div>
      )}

      <div className="mt-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              interval={0}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={formatTick}
            />
            <Tooltip cursor={{ fill: "var(--muted)" }} content={ChartTooltip} />
            <Bar dataKey="total" fill="var(--chart-revenue)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
