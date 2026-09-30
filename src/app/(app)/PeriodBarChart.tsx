"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Range = "day" | "month" | "year";
type Metric = "money" | "count";

// `prev`/`prevLabel` are the same slot in the previous period (last week's
// Mon, last month's Week 1, ...) -- only set while "Compare" is on.
// `years` holds one value per compared year (keyed `y2026`, ...) -- only set
// while the Year view is comparing years, one line per year over Jan-Dec.
type ChartPoint = {
  key: string;
  label: string;
  total: number;
  prev?: number;
  prevLabel?: string;
  years?: Record<string, number>;
  // One value per business (keyed `b0`, `b1`, ... by prop order) -- only on
  // "All Businesses", drawn as a thinner line per business.
  biz?: Record<string, number>;
};

const PREV_COLOR = "hsl(252deg 60% 62%)";
// One line color per business, by position -- picked to stay clear of both
// metric colors (blue Revenue, cyan Orders).
const BIZ_COLORS = [
  "hsl(145deg 55% 38%)",
  "hsl(340deg 72% 55%)",
  "hsl(268deg 60% 60%)",
  "hsl(24deg 85% 55%)",
  "hsl(45deg 90% 45%)",
];
const bizColor = (i: number) => BIZ_COLORS[i % BIZ_COLORS.length];
// What the previous period is called per range, for the legend/tooltip/delta.
const PREV_NAME: Partial<Record<Range, string>> = { day: "last week", month: "last month" };
const CURRENT_NAME: Partial<Record<Range, string>> = { day: "This week", month: "This month" };

// Split a month into the same four bands the Month view charts.
function monthBands(monthStart: Date): [number, number][] {
  const daysInMonth = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return [
    [1, 7],
    [8, 14],
    [15, 21],
    [22, daysInMonth],
  ];
}

const RANGE_LABEL: Record<Range, string> = { day: "Day", month: "Month", year: "Year" };
const UNIT: Record<Range, string> = { day: "day", month: "week", year: "month" };
// What the summed-up total actually covers in each toggle -- the "Day"
// toggle browses a week at a time, so its total is a week's worth, not a
// single day's.
const TOTAL_UNIT: Record<Range, string> = { day: "week", month: "month", year: "year" };
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

// First day of the week/month the chart compares against: the one picked, or
// else the one right before the browsed period.
function compareStartFor(range: Range, anchor: Date, picked: Date | null): Date {
  if (range === "day") return picked ? mondayOf(picked) : addDays(mondayOf(anchor), -7);
  return picked ? startOfMonth(picked) : addMonths(startOfMonth(anchor), -1);
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
    payload?: readonly {
      value?: unknown;
      name?: unknown;
      stroke?: string;
      payload?: Record<string, unknown>;
    }[];
  }) {
    if (!active || !payload?.length) return null;
    const point = payload[0];
    const prev = point.payload?.prev;
    // Year comparison: one row per year line instead of a single value.
    if (point.payload?.years || point.payload?.biz) {
      return (
        <div
          className="min-w-[9rem] rounded-xl border border-white/10 bg-[#161616] px-4 py-3 shadow-xl shadow-black/50"
          style={{ borderTop: `2px solid ${accentColor}` }}
        >
          <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">
            {String(point.payload?.label)}
          </p>
          {payload.map((p) => (
            <p
              key={String(p.name)}
              className="mt-1 flex items-center gap-2 text-sm font-semibold text-white"
            >
              <span className="size-2 rounded-full" style={{ background: p.stroke }} />
              <span className="font-medium text-white/60">{String(p.name)}</span>
              <span className="ml-auto pl-3">{formatValue(Number(p.value))}</span>
            </p>
          ))}
        </div>
      );
    }
    return (
      <div
        className="min-w-[9rem] rounded-xl border border-white/10 bg-[#161616] px-4 py-3 shadow-xl shadow-black/50"
        style={{ borderTop: `2px solid ${accentColor}` }}
      >
        <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">
          {String(point.payload?.label)}
        </p>
        <p className="mt-1 text-base font-semibold text-white">
          {formatValue(Number(point.value))}
        </p>
        {typeof prev === "number" && (
          <>
            <p className="mt-2 text-[11px] font-medium tracking-wide text-white/45 uppercase">
              {String(point.payload?.prevLabel)}
            </p>
            <p className="mt-1 text-base font-semibold" style={{ color: PREV_COLOR }}>
              {formatValue(prev)}
            </p>
          </>
        )}
      </div>
    );
  };
}

// A start/end range can cover a lot of years, so instead of a small
// hand-picked palette (fine for 3-4 years, cramped past that), every
// non-anchor year gets a color stepped around the hue wheel by the golden
// angle (~137.5deg) -- a standard trick for generating N maximally-distinct
// hues without picking each one by hand. `startHue` walks it away from the
// anchor year's own hue (blue for Revenue, cyan for Orders) so the first
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

export type BusinessSeries = {
  id: string;
  name: string;
  dailyData: { date: string; total: number }[];
};

// Shared by every "value per day, browsable by day/week-of-month/year" chart
// on the dashboard (Revenue, Orders, ...) -- only what a value *means* differs
// between them (formatting, the bar color), not how it's bucketed or browsed.
export default function PeriodBarChart({
  title,
  dailyData,
  metric,
  businesses,
  initialRange,
  initialAnchor,
}: {
  title: string;
  dailyData: { date: string; total: number }[];
  metric: Metric;
  // When given, adds an "All Businesses"/per-business selector above the
  // period toggle -- `dailyData` (the combined series, unchanged) stays the
  // "All Businesses" option, so the old all-up chart is still exactly one
  // click away.
  businesses?: BusinessSeries[];
  // Lets an embedding page open this chart already lined up with its own
  // filter (e.g. Accountance's own Day/Month/Year + date) instead of always
  // starting on "this week" -- pass a `key` that changes with that filter so
  // the chart actually remounts and re-reads these on every filter change,
  // since they only apply once, at mount.
  initialRange?: Range;
  initialAnchor?: Date;
}) {
  const { barColor, allowDecimalTicks, formatValue, formatTick } = METRIC[metric];
  const [range, setRange] = useState<Range>(initialRange ?? "day");
  const today = useMemo(() => utcMidnight(new Date()), []);
  const [anchor, setAnchor] = useState<Date>(initialAnchor ?? today);
  // Extra years to total up next to the anchor year -- year range only. e.g.
  // anchor 2026 + compareYears [2027, 2028] shows one bar per year, each
  // year's full total, instead of the anchor year's 12 months.
  const [compareYears, setCompareYears] = useState<number[]>([]);
  const comparingYears = range === "year" && compareYears.length > 0;

  const [businessId, setBusinessId] = useState<string>("all");
  const activeDailyData = useMemo(() => {
    if (businessId === "all") return dailyData;
    return businesses?.find((b) => b.id === businessId)?.dailyData ?? dailyData;
  }, [businessId, businesses, dailyData]);

  const dailyMap = useMemo(
    () => new Map(activeDailyData.map((d) => [d.date, d.total])),
    [activeDailyData]
  );

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

  // A single selected business draws in its own chip color (green for the
  // first, pink for the second, ...); "All Businesses" keeps the metric color.
  const selectedBizIndex = businesses?.findIndex((b) => b.id === businessId) ?? -1;
  const lineColor = selectedBizIndex >= 0 ? bizColor(selectedBizIndex) : barColor;

  const ChartTooltip = useMemo(() => makeTooltip(formatValue, lineColor), [formatValue, lineColor]);

  // Overlay the previous week (Day view) / month (Month view) on the chart --
  // Mon vs last Mon, Week 1 vs last month's Week 1.
  const [compareOn, setCompareOn] = useState(false);
  const comparingPrev = compareOn && (range === "day" || range === "month");
  // The week/month to compare against. null = the one right before the
  // browsed period; otherwise whatever date/month staff picked (snapped to
  // that date's week or month below).
  const [compareAnchor, setCompareAnchor] = useState<Date | null>(null);
  const compareStart = compareStartFor(range, anchor, compareAnchor);
  const compareName = !compareAnchor
    ? (PREV_NAME[range] ?? "")
    : range === "day"
      ? `week of ${fmtShort(compareStart)}, ${compareStart.getUTCFullYear()}`
      : compareStart.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

  // Years drawn as separate lines while comparing (anchor year included).
  const shownYears = useMemo(
    () =>
      comparingYears
        ? Array.from(new Set([startOfYear(anchor).getUTCFullYear(), ...compareYears]))
            .sort((a, b) => a - b)
            .slice(0, MAX_COMPARE_YEARS)
        : [],
    [comparingYears, anchor, compareYears]
  );

  // Per-business lines under the combined one -- only on "All Businesses", and
  // not while another comparison is already drawing extra lines.
  const showBizLines =
    businessId === "all" && !!businesses?.length && !comparingYears && !comparingPrev;

  const { data, periodLabel, isCurrent } = useMemo((): {
    data: ChartPoint[];
    periodLabel: string;
    isCurrent: boolean;
  } => {
    const build = (
      dailyMap: Map<string, number>
    ): { data: ChartPoint[]; periodLabel: string; isCurrent: boolean } => {
      if (range === "day") {
        const monday = mondayOf(anchor);
        const prevMonday = compareStartFor(range, anchor, compareAnchor);
        const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
        const points: ChartPoint[] = days.map((d, i) => {
          const prevDay = addDays(prevMonday, i);
          return {
            key: DAY_LABELS[i],
            total: dailyMap.get(toKey(d)) ?? 0,
            label: d.toLocaleDateString("en", {
              weekday: "long",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
            ...(comparingPrev && {
              prev: dailyMap.get(toKey(prevDay)) ?? 0,
              prevLabel: prevDay.toLocaleDateString("en", {
                weekday: "long",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }),
            }),
          };
        });
        const sunday = days[6];
        const label =
          monday.getUTCFullYear() === sunday.getUTCFullYear()
            ? `${fmtShort(monday)} - ${fmtShort(sunday)}, ${sunday.getUTCFullYear()}`
            : `${fmtShort(monday)}, ${monday.getUTCFullYear()} - ${fmtShort(sunday)}, ${sunday.getUTCFullYear()}`;
        return {
          data: points,
          periodLabel: label,
          isCurrent: monday.getTime() >= mondayOf(today).getTime(),
        };
      }

      if (range === "month") {
        const monthStart = startOfMonth(anchor);
        const bandTotal = (start: Date, from: number, to: number) => {
          let total = 0;
          for (let day = from; day <= to; day++) {
            const key = toKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day)));
            total += dailyMap.get(key) ?? 0;
          }
          return total;
        };
        const prevMonthStart = compareStartFor(range, anchor, compareAnchor);
        const prevBands = monthBands(prevMonthStart);
        const prevMonthName = prevMonthStart.toLocaleDateString("en", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
        const points: ChartPoint[] = monthBands(monthStart).map(([from, to], i) => ({
          key: `Week ${i + 1}`,
          total: bandTotal(monthStart, from, to),
          label: `Week ${i + 1} (day ${from === to ? from : `${from}-${to}`})`,
          ...(comparingPrev && {
            prev: bandTotal(prevMonthStart, prevBands[i][0], prevBands[i][1]),
            prevLabel: `Week ${i + 1}, ${prevMonthName}`,
          }),
        }));
        const label = monthStart.toLocaleDateString("en", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
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

      // Comparing years: one line per selected year over Jan-Dec, so the same
      // month lines up across years. `total` is the month's sum over all years.
      const points: ChartPoint[] = MONTH_LABELS.map((m, i) => {
        const monthPart = String(i + 1).padStart(2, "0");
        const perYear: Record<string, number> = {};
        let total = 0;
        for (const y of shownYears) {
          const prefix = `${y}-${monthPart}`;
          let sum = 0;
          for (const [key, value] of dailyMap) {
            if (key.startsWith(prefix)) sum += value;
          }
          perYear[`y${y}`] = sum;
          total += sum;
        }
        return { key: m, total, label: m, years: perYear };
      });
      return { data: points, periodLabel: shownYears.join(" vs "), isCurrent };
    };

    const main = build(dailyMap);
    if (showBizLines) {
      businesses?.forEach((b, bi) => {
        const bMap = new Map(b.dailyData.map((d) => [d.date, d.total]));
        const bData = build(bMap).data;
        main.data.forEach((p, i) => {
          p.biz = { ...p.biz, [`b${bi}`]: bData[i].total };
        });
      });
    }
    return main;
  }, [
    range,
    anchor,
    dailyMap,
    today,
    compareYears,
    comparingPrev,
    compareAnchor,
    shownYears,
    businesses,
    showBizLines,
  ]);

  // Sum of whatever bars are currently on screen -- the day toggle's week,
  // the month toggle's four weeks, or the year toggle's twelve months (or
  // its compared years), so switching Day/Month/Year always reads as "total
  // earned this day-range/month/year", not just a per-bar breakdown.
  const periodTotal = useMemo(() => data.reduce((sum, d) => sum + d.total, 0), [data]);
  const prevTotal = useMemo(() => data.reduce((sum, d) => sum + (d.prev ?? 0), 0), [data]);
  // null when the previous period had nothing to compare against.
  const deltaPct = prevTotal > 0 ? ((periodTotal - prevTotal) / prevTotal) * 100 : null;

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
                  ? "bg-brand text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Business filter -- "All Businesses" is the pre-existing combined
          series, so switching here never loses the old all-up view. Only
          rendered when the page actually has per-business data to offer. */}
      {businesses && businesses.length > 0 && (
        <div className="mt-3 inline-flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setBusinessId("all")}
            aria-pressed={businessId === "all"}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              businessId === "all"
                ? "border-brand bg-brand text-white"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            All Businesses
          </button>
          {businesses.map((b, bi) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBusinessId(b.id)}
              aria-pressed={businessId === b.id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                businessId === b.id
                  ? "border-brand bg-brand text-white"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="size-2 rounded-full" style={{ background: bizColor(bi) }} />
              {b.name}
            </button>
          ))}
        </div>
      )}

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
        {(range === "day" || range === "month") && (
          <button
            type="button"
            onClick={() => setCompareOn((v) => !v)}
            aria-pressed={compareOn}
            className={`ml-3 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              compareOn
                ? "border-brand bg-brand text-white"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Compare
          </button>
        )}
        {comparingPrev && (
          <span className="ml-1 inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            with
            <input
              type={range === "day" ? "date" : "month"}
              value={range === "day" ? toKey(compareStart) : toKey(compareStart).slice(0, 7)}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setCompareAnchor(new Date(`${range === "day" ? v : `${v}-01`}T00:00:00Z`));
              }}
              aria-label={range === "day" ? "Compare with the week of" : "Compare with month"}
              className="rounded-full border border-border bg-transparent px-2.5 py-0.5 text-xs text-foreground outline-none focus:border-brand"
            />
            {range === "day" && <span>(its whole week)</span>}
            {compareAnchor && (
              <button
                type="button"
                onClick={() => setCompareAnchor(null)}
                className="font-medium text-brand hover:underline"
              >
                Reset to {PREV_NAME[range]}
              </button>
            )}
          </span>
        )}
      </div>

      {/* The headline number this card exists for -- how much this exact
          view (the week/month/year on screen, for whichever business is
          selected) adds up to, spelled out instead of left for the reader to
          add up off the bars themselves. */}
      <p className="mt-2 text-2xl font-bold">
        {formatValue(periodTotal)}
        <span className="ml-2 text-xs font-medium text-muted-foreground">
          {comparingYears ? "combined total" : `total this ${TOTAL_UNIT[range]}`}
        </span>
      </p>

      {comparingPrev && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span className="size-2 rounded-full" style={{ background: lineColor }} />
            {CURRENT_NAME[range]} · {formatValue(periodTotal)}
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <span className="size-2 rounded-full" style={{ background: PREV_COLOR }} />
            {compareName[0].toUpperCase() + compareName.slice(1)} · {formatValue(prevTotal)}
          </span>
          {deltaPct !== null && (
            <span
              className={`font-semibold ${
                deltaPct >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {deltaPct >= 0 ? "+" : ""}
              {deltaPct.toFixed(1)}% vs {compareName}
            </span>
          )}
        </div>
      )}

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
            className="rounded-full bg-brand px-3 py-0.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
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
          {shownYears.map((y) => (
            <span
              key={y}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-foreground"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: yearColors[y] ?? barColor }}
              />
              {y}:{" "}
              <span className="font-semibold">
                {formatValue(data.reduce((sum, d) => sum + (d.years?.[`y${y}`] ?? 0), 0))}
              </span>
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
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <defs>
              {/* Soft fade from the line color down to transparent. */}
              <linearGradient id={gradientIdFor("primary")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
              </linearGradient>
              {shownYears.map((y) => (
                <linearGradient key={y} id={gradientIdFor(y)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={yearColors[y] ?? barColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={yearColors[y] ?? barColor} stopOpacity={0.02} />
                </linearGradient>
              ))}
              <linearGradient id={gradientIdFor("prev")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PREV_COLOR} stopOpacity={0.2} />
                <stop offset="100%" stopColor={PREV_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              interval={0}
              padding={{ left: 16, right: 16 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={formatTick}
              allowDecimals={allowDecimalTicks}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)", strokeDasharray: "3 4" }}
              content={ChartTooltip}
            />
            {shownYears.map((y) => (
              <Area
                key={y}
                type="monotone"
                name={String(y)}
                dataKey={`years.y${y}`}
                stroke={yearColors[y] ?? barColor}
                strokeWidth={2.5}
                fill={`url(#${gradientIdFor(y)})`}
                activeDot={{
                  r: 5,
                  stroke: "var(--card)",
                  strokeWidth: 2,
                  fill: yearColors[y] ?? barColor,
                }}
              />
            ))}
            {showBizLines &&
              businesses?.map((b, bi) => (
                <Area
                  key={b.id}
                  type="monotone"
                  name={b.name}
                  dataKey={`biz.b${bi}`}
                  stroke={bizColor(bi)}
                  strokeWidth={2}
                  fill="none"
                  activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2, fill: bizColor(bi) }}
                />
              ))}
            {!comparingYears && (
              <Area
                type="monotone"
                name={showBizLines ? "All Businesses" : undefined}
                dataKey="total"
                stroke={lineColor}
                strokeWidth={2.5}
                fill={`url(#${gradientIdFor("primary")})`}
                activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: lineColor }}
              />
            )}
            {/* Declared after the main series so the tooltip's first payload
                entry stays the current period. */}
            {comparingPrev && (
              <Area
                type="monotone"
                dataKey="prev"
                stroke={PREV_COLOR}
                strokeWidth={2.5}
                fill={`url(#${gradientIdFor("prev")})`}
                activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: PREV_COLOR }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
