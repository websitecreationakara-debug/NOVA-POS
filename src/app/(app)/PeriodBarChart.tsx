"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Range = "day" | "month" | "year";
type Metric = "money" | "count";

type ChartPoint = { key: string; label: string; total: number };

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

// Deliberately dark regardless of the site's own light/dark toggle -- a
// tooltip floating over a chart reads as its own small surface, and a fixed
// near-black card with a gold-lit top edge is the "premium dashboard" look
// this was asked for, not just the theme's card color with a border.
function makeTooltip(formatValue: (n: number) => string, accentColor: string) {
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
      <div
        className="min-w-[9rem] rounded-xl border border-white/10 bg-[#161616] px-4 py-3 shadow-xl shadow-black/50"
        style={{ borderTop: `2px solid ${accentColor}` }}
      >
        <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">
          {String(point.payload?.label)}
        </p>
        <p className="mt-1 text-base font-semibold text-white">{formatValue(Number(point.value))}</p>
      </div>
    );
  };
}

// A start/end range can cover a lot of years, so instead of a small
// hand-picked palette (fine for 3-4 years, cramped past that), every
// non-anchor year gets a color stepped around the hue wheel by the golden
// angle (~137.5deg) -- a standard trick for generating N maximally-distinct
// hues without picking each one by hand. `startHue` walks it away from the
// anchor year's own hue (gold for Revenue, blue for Orders) so the first
// couple of comparison years don't land near-identical to it.
const OTHER_YEAR_START_HUE: Record<Metric, number> = { money: 300, count: 20 };
const GOLDEN_ANGLE = 137.508;

function colorForOtherYear(i: number, metric: Metric): string {
  const hue = (OTHER_YEAR_START_HUE[metric] + i * GOLDEN_ANGLE) % 360;
  return `hsl(${hue.toFixed(1)}deg 62% 54%)`;
}

// Compare this many years at once, tops -- purely a sanity cap (a "start
// year - end year" range could otherwise ask for decades of bars).
const MAX_COMPARE_YEARS = 12;

// Every bar color the chart can ever use, keyed by year, gets its own
// <linearGradient> (see the <defs> below) so every bar has the glowing
// gradient fill, not just the primary metric color. "primary" covers the
// single-series (non-comparing) chart.
function gradientIdFor(key: string | number): string {
  return `bar-gradient-${key}`;
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
  const [range, setRange] = useState<Range>("day");
  const today = useMemo(() => utcMidnight(new Date()), []);
  const [anchor, setAnchor] = useState<Date>(today);
  // Extra years to total up next to the anchor year -- year range only. e.g.
  // anchor 2026 + compareYears [2027, 2028] shows one bar per year, each
  // year's full total, instead of the anchor year's 12 months.
  const [compareYears, setCompareYears] = useState<number[]>([]);
  const comparingYears = range === "year" && compareYears.length > 0;

  const dailyMap = useMemo(() => new Map(dailyData.map((d) => [d.date, d.total])), [dailyData]);

  // Every year currently selectable/selected -> the bar color it'll use once
  // picked, anchor year first so it keeps this chart's own metric color.
  const yearColors = useMemo(() => {
    const anchorYear = startOfYear(anchor).getUTCFullYear();
    const others = compareYears.filter((y) => y !== anchorYear).sort((a, b) => a - b);
    const colors: Record<number, string> = { [anchorYear]: barColor };
    others.forEach((y, i) => {
      colors[y] = colorForOtherYear(i, metric);
    });
    return colors;
  }, [anchor, compareYears, barColor, metric]);

  // Fill in every year between two endpoints in one go, instead of clicking
  // each chip -- replaces whatever was already selected for comparison.
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  function applyRange() {
    const start = Number(rangeStart);
    const end = Number(rangeEnd);
    if (!start || !end || start > end) return;
    const anchorYear = startOfYear(anchor).getUTCFullYear();
    const years: number[] = [];
    for (let y = start; y <= end && years.length < MAX_COMPARE_YEARS - 1; y++) {
      if (y !== anchorYear) years.push(y);
    }
    setCompareYears(years);
  }

  const ChartTooltip = useMemo(() => makeTooltip(formatValue, barColor), [formatValue, barColor]);

  const { data, periodLabel, isCurrent } = useMemo((): {
    data: ChartPoint[];
    periodLabel: string;
    isCurrent: boolean;
  } => {
    if (range === "day") {
      const monday = mondayOf(anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
      const points: ChartPoint[] = days.map((d, i) => ({
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
      const points: ChartPoint[] = bands.map(([from, to], i) => {
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
    const anchorYear = yearStart.getUTCFullYear();
    const isCurrent = yearStart.getTime() >= startOfYear(today).getTime();

    if (compareYears.length === 0) {
      // The usual view: the anchor year's 12 months.
      const points: ChartPoint[] = MONTH_LABELS.map((m, i) => {
        const prefix = `${anchorYear}-${String(i + 1).padStart(2, "0")}`;
        let total = 0;
        for (const [key, value] of dailyMap) {
          if (key.startsWith(prefix)) total += value;
        }
        return { key: m, total, label: `${m} ${anchorYear}` };
      });
      return { data: points, periodLabel: `${anchorYear}`, isCurrent };
    }

    // Comparing years: one bar per selected year, each year's full-year
    // total -- "how much did we earn in 2026, in 2027, ..." side by side.
    const years = Array.from(new Set([anchorYear, ...compareYears]))
      .sort((a, b) => a - b)
      .slice(0, MAX_COMPARE_YEARS);
    const points: ChartPoint[] = years.map((y) => {
      const prefix = `${y}-`;
      let total = 0;
      for (const [key, value] of dailyMap) {
        if (key.startsWith(prefix)) total += value;
      }
      return { key: String(y), total, label: `${y}` };
    });
    return { data: points, periodLabel: years.join(" vs "), isCurrent };
  }, [range, anchor, dailyMap, today, compareYears]);

  // Only call out a best/worst when there's an actual spread to report --
  // an all-zero period (nothing happened yet) has no "best day" worth
  // labeling. In year-compare mode this becomes "best/slowest year".
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
        <span className="min-w-44 text-center text-sm font-medium">{periodLabel}</span>
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

      {/* Faster than clicking each chip for a wide span -- fills in every
          year between the two endpoints (minus the anchor year) in one go. */}
      {range === "year" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Compare a range:</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Start"
            value={rangeStart}
            onChange={(e) => setRangeStart(e.target.value)}
            className="w-20 rounded-full border border-border bg-transparent px-2.5 py-0.5 text-xs text-foreground outline-none focus:border-brand"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="End"
            value={rangeEnd}
            onChange={(e) => setRangeEnd(e.target.value)}
            className="w-20 rounded-full border border-border bg-transparent px-2.5 py-0.5 text-xs text-foreground outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={applyRange}
            disabled={!rangeStart || !rangeEnd || Number(rangeStart) > Number(rangeEnd)}
            className="rounded-full bg-brand px-3 py-0.5 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            Compare
          </button>
          {compareYears.length > 0 && (
            <button
              type="button"
              onClick={() => setCompareYears([])}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Explicit "how much did we earn" readout, one pill per year, when
          comparing years -- the chart makes the shape obvious, this makes
          the exact numbers easy to read off without hovering each bar. */}
      {comparingYears && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {data.map((d) => (
            <span
              key={d.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-foreground"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: yearColors[Number(d.key)] ?? barColor }}
              />
              {d.key}: <span className="font-semibold">{formatValue(d.total)}</span>
            </span>
          ))}
        </div>
      )}

      {!comparingYears && (best || worst) && (
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
              {/* A glowing gradient per bar color actually in use this
                  render -- the metric color always, plus one per comparison
                  year while comparing. */}
              <linearGradient id={gradientIdFor("primary")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={barColor} stopOpacity={1} />
                <stop offset="100%" stopColor={barColor} stopOpacity={0.35} />
              </linearGradient>
              {comparingYears &&
                data.map((d) => {
                  const c = yearColors[Number(d.key)] ?? barColor;
                  return (
                    <linearGradient key={d.key} id={gradientIdFor(d.key)} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c} stopOpacity={1} />
                      <stop offset="100%" stopColor={c} stopOpacity={0.35} />
                    </linearGradient>
                  );
                })}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
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
              fill={`url(#${gradientIdFor("primary")})`}
              radius={[6, 6, 0, 0]}
              maxBarSize={40}
              // Subtle lift on the hovered bar -- a soft white outline over the
              // same gradient, rather than swapping to a flat highlight color.
              activeBar={{ stroke: "rgba(255,255,255,0.5)", strokeWidth: 1.5 }}
            >
              {/* One gradient per year when comparing years -- otherwise the
                  single metric gradient above covers every bar as before. */}
              {comparingYears && data.map((d) => <Cell key={d.key} fill={`url(#${gradientIdFor(d.key)})`} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
