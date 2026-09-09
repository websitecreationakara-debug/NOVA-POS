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
type Metric = "money" | "count";

const RANGE_LABEL: Record<Range, string> = { day: "Day", month: "Month", year: "Year" };
const UNIT: Record<Range, string> = { day: "day", month: "week", year: "month" };
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Functions can't cross the server/client boundary as props, so formatting
// is picked here from a plain string flag instead of being passed in.
const METRIC = {
  money: {
    barColor: "var(--chart-revenue)",
    allowDecimalTicks: true,
    formatValue: (n: number) => `$${n.toFixed(2)}`,
    formatTick: (n: number) => `$${new Intl.NumberFormat("en", { notation: "compact" }).format(n)}`,
  },
  count: {
    barColor: "var(--chart-orders)",
    allowDecimalTicks: false,
    formatValue: (n: number) => `${n} order${n === 1 ? "" : "s"}`,
    formatTick: (n: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(n),
  },
};

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

function makeTooltip(formatValue: (n: number) => string) {
  return function ChartTooltip({
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
        <p className="font-semibold text-foreground">{formatValue(Number(point.value))}</p>
      </div>
    );
  };
}

// Shared by every "value per day, browsable by day/week-of-month/year" chart
// on the dashboard (Revenue, Orders, ...) -- only what a value *means* differs
// between them (formatting, the bar color), not how it's bucketed or browsed.
export default function PeriodBarChart({
  title,
  dailyData,
  metric,
}: {
  title: string;
  dailyData: { date: string; total: number }[];
  metric: Metric;
}) {
  const { barColor, allowDecimalTicks, formatValue, formatTick } = METRIC[metric];
  const gradientId = `bar-gradient-${metric}`;
  const [range, setRange] = useState<Range>("day");
  const today = useMemo(() => utcMidnight(new Date()), []);
  const [anchor, setAnchor] = useState<Date>(today);

  const dailyMap = useMemo(() => new Map(dailyData.map((d) => [d.date, d.total])), [dailyData]);

  const ChartTooltip = useMemo(() => makeTooltip(formatValue), [formatValue]);

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
  // an all-zero period (nothing happened yet) has no "best day" worth labeling.
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
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {/* Segmented control -- one bordered pill track, active segment filled. */}
        <div className="inline-flex rounded-full border border-border bg-muted/60 p-0.5">
          {(["day", "month", "year"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-full px-3.5 py-1 text-sm font-medium transition-colors ${
                range === r
                  ? "bg-brand text-black shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
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
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {best && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" />
              Best {UNIT[range]}: {best.key} · {formatValue(best.total)}
            </span>
          )}
          {worst && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 font-medium text-warning">
              <span className="size-1.5 rounded-full bg-warning" />
              Slowest {UNIT[range]}: {worst.key} · {formatValue(worst.total)}
            </span>
          )}
        </div>
      )}

      <div className="mt-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap="20%">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={barColor} stopOpacity={0.95} />
                <stop offset="100%" stopColor={barColor} stopOpacity={0.3} />
              </linearGradient>
            </defs>
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
              allowDecimals={allowDecimalTicks}
            />
            <Tooltip cursor={{ fill: "var(--muted)" }} content={ChartTooltip} />
            <Bar
              dataKey="total"
              fill={`url(#${gradientId})`}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
