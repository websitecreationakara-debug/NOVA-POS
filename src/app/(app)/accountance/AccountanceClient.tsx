"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Info,
  Pencil,
  Percent,
  PiggyBank,
  Receipt,
  SearchX,
  ShoppingBag,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import type { Brand, CashReconciliation, Expense, Order } from "@/types/database";
import {
  ALL_BUSINESSES_ID,
  type CogsSummary,
  type DailySalesSummary,
  type MarginReportRow,
  type StockPickerItem,
  type WasteLogEntry,
} from "@/lib/supabase/queries";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/paymentMethods";
import { addExpenseAction, saveReconciliationAction, updateExpenseAction } from "./actions";
import { setProductCostAction, setProductPriceAction } from "../stock/actions";
import { exportAccountancePdf } from "@/lib/exportAccountancePdf";
import DeleteExpenseDialog from "@/components/DeleteExpenseDialog";
import BulkAddCostPriceModal from "@/components/BulkAddCostPriceModal";
import AddWasteItemModal from "@/components/AddWasteItemModal";
import EditWasteLogModal from "@/components/EditWasteLogModal";
import DeleteWasteLogDialog from "@/components/DeleteWasteLogDialog";
import type { AccountanceTab } from "./page";

type RangeMode = "day" | "week" | "month" | "quarter" | "year";

const TAB_LABELS: Record<AccountanceTab, string> = {
  reconciliation: "Cash Reconciliation",
  expenses: "Expense & Accounts Payable",
  reports: "Financial Reporting & P&L",
  cogs: "COGS & Margin Tracking",
};

type ChartGranularity = "hour" | "day" | "month";
const GRANULARITY_LABEL: Record<ChartGranularity, string> = { hour: "Hourly", day: "Daily", month: "Monthly" };
const GRANULARITY_UNIT: Record<ChartGranularity, string> = { hour: "hour", day: "day", month: "month" };

// One color per payment method, cycled if there are ever more methods than
// colors -- cash keeps the blue it always had.
const PAYMENT_METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: "#2a78d6",
  aba_pay: "#eb6834",
  wing: "#c026d3",
  khqr: "#16a34a",
  card: "#9333ea",
  bank_qr: "#6b7280",
};

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// Color-coded trend chip for a metric card -- "positive" (green) for a
// healthy margin, "negative" (muted red) for high waste/expense.
function TrendBadge({ tone, children }: { tone: "positive" | "negative"; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        tone === "positive"
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
          : "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
      }`}
    >
      {children}
    </span>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Ring chart built from plain stroked-circle segments (no charting lib) --
// each segment's share of `circumference` is a dash, offset by however much
// of the ring the earlier segments already used. Rotated -90deg so the first
// segment starts at 12 o'clock like every other pie/donut convention.
function PaymentDonut({ segments }: { segments: { color: string; value: number }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" className="size-24 shrink-0 -rotate-90">
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        strokeWidth={14}
        className="stroke-black/[.06] dark:stroke-white/[.08]"
      />
      {total > 0 &&
        segments.map((s, i) => {
          const dash = (s.value / total) * circumference;
          const el = (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={14}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
    </svg>
  );
}

// One point of the Revenue vs Expenses chart -- either an hour-of-day bucket
// (single-day view) or a calendar-day bucket (any longer range). `label` is
// the axis/tooltip display text; `hour` is only set for an hourly point (lets
// the chart re-derive the "3 AM"-style tick text without re-parsing a string).
type TimeSeriesPoint = { label: string; hour?: number; revenue: number; expense: number; orders: number };

function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

// Orders carry a real paid_at timestamp, so a single day can break revenue
// down by hour -- expenses only ever carry a date (no time of day), so
// there's nothing meaningful to bucket hourly for them; the expense line is
// only drawn for the daily (multi-day range) series below.
function buildHourlySeries(orders: Order[]): TimeSeriesPoint[] {
  const buckets: TimeSeriesPoint[] = Array.from({ length: 24 }, (_, h) => ({
    label: formatHourLabel(h),
    hour: h,
    revenue: 0,
    expense: 0,
    orders: 0,
  }));
  for (const o of orders) {
    if (!o.paid_at) continue;
    const hour = new Date(o.paid_at).getHours();
    buckets[hour].revenue += o.total;
    buckets[hour].orders += 1;
  }
  return buckets;
}

function buildDailySeries(orders: Order[], expenses: Expense[], fromDate: string, toDate: string): TimeSeriesPoint[] {
  const days: TimeSeriesPoint[] = [];
  const revenueByDate = new Map<string, number>();
  const orderCountByDate = new Map<string, number>();
  for (const o of orders) {
    if (!o.paid_at) continue;
    const d = o.paid_at.slice(0, 10);
    revenueByDate.set(d, (revenueByDate.get(d) ?? 0) + o.total);
    orderCountByDate.set(d, (orderCountByDate.get(d) ?? 0) + 1);
  }
  const expenseByDate = new Map<string, number>();
  for (const e of expenses) {
    expenseByDate.set(e.expense_date, (expenseByDate.get(e.expense_date) ?? 0) + e.amount);
  }
  let cursor = fromDate;
  // Capped so an accidental huge range (or a bad date pair) can't build an
  // unbounded array -- a year is the longest range this page's own Day/Week/
  // Month/Quarter/Year picker can ever produce (366 days).
  for (let i = 0; i < 370 && cursor <= toDate; i++) {
    days.push({
      label: new Date(`${cursor}T00:00:00.000Z`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      revenue: revenueByDate.get(cursor) ?? 0,
      expense: expenseByDate.get(cursor) ?? 0,
      orders: orderCountByDate.get(cursor) ?? 0,
    });
    const d = new Date(`${cursor}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return days;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Year mode covers 366 days -- a daily series there is hundreds of thin
// spikes, so it's bucketed by calendar month instead (Jan..Dec).
function buildMonthlySeries(orders: Order[], expenses: Expense[], year: string): TimeSeriesPoint[] {
  const months: TimeSeriesPoint[] = MONTH_LABELS.map((label) => ({ label, revenue: 0, expense: 0, orders: 0 }));
  for (const o of orders) {
    if (!o.paid_at || o.paid_at.slice(0, 4) !== year) continue;
    const m = Number(o.paid_at.slice(5, 7)) - 1;
    months[m].revenue += o.total;
    months[m].orders += 1;
  }
  for (const e of expenses) {
    if (e.expense_date.slice(0, 4) !== year) continue;
    const m = Number(e.expense_date.slice(5, 7)) - 1;
    months[m].expense += e.amount;
  }
  return months;
}

// Rounds a chart's max value up to a "nice" round number (a multiple of
// 1/2/5 x a power of ten) so the Y-axis reads $0/$50/$100/$150 instead of
// whatever the data's exact max happens to be.
function niceAxisMax(maxVal: number): number {
  if (maxVal <= 0) return 1;
  const rough = maxVal / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const niceResidual = residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1;
  return niceResidual * magnitude * 3;
}

// Evenly-spaced indices into a `count`-long series, capped at `target` labels
// -- e.g. a year's worth of daily points still only shows ~6 x-axis labels.
function pickTickIndices(count: number, target: number): number[] {
  if (count <= target) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (target - 1);
  return Array.from({ length: target }, (_, i) => Math.round(i * step));
}

// Revenue (and, for a daily series, Expenses) as two smoothed lines over
// `points` -- an inline SVG rather than a charting dependency, since this is
// the only chart-shaped thing on this page.
function RevenueExpenseChart({
  points,
  showExpense,
  granularity,
  chartType,
}: {
  points: TimeSeriesPoint[];
  showExpense: boolean;
  granularity: ChartGranularity;
  chartType: "line" | "bar";
}) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // A new date range/brand/tab selection hands this component a brand-new
  // `points` array -- drop any hover state left over from the old one.
  // Resetting during render (React's documented pattern for "adjusting state
  // when a prop changes") rather than in an effect avoids an extra render
  // pass showing the stale hover for one frame.
  const [lastPoints, setLastPoints] = useState(points);
  if (lastPoints !== points) {
    setLastPoints(points);
    setHoverIndex(null);
  }

  const displayPoints = points;

  const width = 600;
  const height = 160;
  const pad = 6;
  const rawMax = Math.max(...displayPoints.map((p) => Math.max(p.revenue, p.expense)));
  const axisMax = niceAxisMax(rawMax);
  const n = displayPoints.length;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => height - pad - (Math.min(v, axisMax) / axisMax) * (height - pad * 2);
  const baselineY = y(0);
  const linePath = (key: "revenue" | "expense") =>
    displayPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const areaPath = (key: "revenue" | "expense") =>
    `${linePath(key)} L ${x(n - 1).toFixed(1)} ${baselineY.toFixed(1)} L ${x(0).toFixed(1)} ${baselineY.toFixed(1)} Z`;

  // Column boundaries -- the hover hit-areas below, and (in bar mode) each
  // column's own bar(s) -- are the midpoint between each pair of neighboring
  // points, so hovering/clicking anywhere between two points snaps to
  // whichever one is closer.
  const colBounds = displayPoints.map((_, i) => {
    const start = i === 0 ? 0 : (x(i - 1) + x(i)) / 2;
    const end = i === n - 1 ? width : (x(i) + x(i + 1)) / 2;
    return { start, end };
  });

  const yTicks = [0, axisMax / 3, (axisMax * 2) / 3, axisMax];
  // "12 AM, 3 AM, ... 9 PM" -- every 3rd hour, same fixed set regardless of
  // where activity actually fell, so the axis reads the same day to day.
  const xTickIndices =
    granularity === "hour" ? [0, 3, 6, 9, 12, 15, 18, 21] : pickTickIndices(n, Math.min(n, 6));

  const hovered = hoverIndex !== null ? displayPoints[hoverIndex] : null;
  const hoveredLabel = hovered ? (hovered.hour !== undefined ? formatHourLabel(hovered.hour) : hovered.label) : null;

  // Highest-revenue point in the currently visible window -- pinned on the
  // chart so it doesn't only show up on hover.
  const peakIndex =
    n === 0
      ? null
      : displayPoints.reduce((best, p, i) => (p.revenue > displayPoints[best].revenue ? i : best), 0);
  const barGap = 2;

  return (
    <div className="flex gap-2">
      <div className="flex h-40 w-11 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] font-medium text-zinc-600 dark:text-zinc-300">
        {[...yTicks].reverse().map((v, i) => (
          <span key={i}>${Math.round(v)}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-40 w-full">
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient id={`${gradientId}-rev`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#16a34a" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`${gradientId}-exp`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#dc2626" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
              </linearGradient>
            </defs>
            {yTicks.map((v, i) => (
              <line
                key={i}
                x1={0}
                x2={width}
                y1={y(v)}
                y2={y(v)}
                strokeDasharray="4 4"
                className="stroke-black/[.1] dark:stroke-white/[.14]"
                strokeWidth={1}
              />
            ))}
            {chartType === "bar" ? (
              displayPoints.map((p, i) => {
                const { start, end } = colBounds[i];
                if (showExpense) {
                  const barWidth = Math.max(0, (end - start - barGap * 3) / 2);
                  const revX = start + barGap;
                  const expX = revX + barWidth + barGap;
                  return (
                    <g key={i}>
                      <rect
                        x={revX}
                        y={y(p.revenue)}
                        width={barWidth}
                        height={Math.max(0, baselineY - y(p.revenue))}
                        fill="#16a34a"
                      />
                      <rect
                        x={expX}
                        y={y(p.expense)}
                        width={barWidth}
                        height={Math.max(0, baselineY - y(p.expense))}
                        fill="#dc2626"
                      />
                    </g>
                  );
                }
                const barWidth = Math.max(0, end - start - barGap * 2);
                return (
                  <rect
                    key={i}
                    x={start + barGap}
                    y={y(p.revenue)}
                    width={barWidth}
                    height={Math.max(0, baselineY - y(p.revenue))}
                    fill="#16a34a"
                  />
                );
              })
            ) : (
              <>
                <path d={areaPath("revenue")} stroke="none" fill={`url(#${gradientId}-rev)`} />
                {showExpense && <path d={areaPath("expense")} stroke="none" fill={`url(#${gradientId}-exp)`} />}
                <path d={linePath("revenue")} fill="none" stroke="#16a34a" strokeWidth={2} />
                {showExpense && <path d={linePath("expense")} fill="none" stroke="#dc2626" strokeWidth={2} />}
              </>
            )}
            {peakIndex !== null && peakIndex !== hoverIndex && (
              <circle
                cx={x(peakIndex)}
                cy={y(displayPoints[peakIndex].revenue)}
                r={3}
                fill="#16a34a"
                stroke="white"
                strokeWidth={1.5}
              />
            )}
            {hoverIndex !== null && (
              <>
                <line
                  x1={x(hoverIndex)}
                  x2={x(hoverIndex)}
                  y1={0}
                  y2={height}
                  className="stroke-black/20 dark:stroke-white/20"
                  strokeWidth={1}
                />
                <circle cx={x(hoverIndex)} cy={y(displayPoints[hoverIndex].revenue)} r={3.5} fill="#16a34a" />
                {showExpense && (
                  <circle cx={x(hoverIndex)} cy={y(displayPoints[hoverIndex].expense)} r={3.5} fill="#dc2626" />
                )}
              </>
            )}
            {/* Invisible per-column hit areas -- kept as plain rects (not tied
                to marker radius) so hovering works across each point's whole
                share of the width, not just a few pixels right on the line. */}
            {colBounds.map((b, i) => (
              <rect
                key={i}
                x={b.start}
                y={0}
                width={Math.max(0, b.end - b.start)}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
              />
            ))}
          </svg>
          {peakIndex !== null && peakIndex !== hoverIndex && (
            <div
              className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-full rounded border border-green-600/30 bg-green-50 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-green-700 dark:border-green-400/30 dark:bg-green-950 dark:text-green-400"
              style={{
                left: `${(x(peakIndex) / width) * 100}%`,
                top: `${(y(displayPoints[peakIndex].revenue) / height) * 100}%`,
                marginTop: "-6px",
              }}
            >
              Peak: {formatMoney(displayPoints[peakIndex].revenue)}
            </div>
          )}
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg dark:border-white/10 dark:bg-zinc-800"
              style={{
                left: `${(x(hoverIndex as number) / width) * 100}%`,
                top: `${(y(Math.max(hovered.revenue, hovered.expense)) / height) * 100}%`,
                marginTop: "-8px",
              }}
            >
              <div className="font-medium text-foreground">{hoveredLabel}</div>
              <div className="mt-0.5 space-y-0.5 text-zinc-500">
                <div>
                  Revenue: <span className="font-medium text-foreground">{formatMoney(hovered.revenue)}</span>
                </div>
                {showExpense && (
                  <div>
                    Expenses: <span className="font-medium text-foreground">{formatMoney(hovered.expense)}</span>
                  </div>
                )}
                {showExpense && (
                  <div>
                    Net profit:{" "}
                    <span
                      className={`font-medium ${
                        hovered.revenue - hovered.expense < 0 ? "text-rose-500" : "text-foreground"
                      }`}
                    >
                      {formatMoney(hovered.revenue - hovered.expense)}
                    </span>
                  </div>
                )}
                <div>
                  {hovered.orders} order{hovered.orders === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="relative mt-1 h-3.5 w-full text-[10px] text-zinc-400">
          {xTickIndices.map((i) => (
            <span key={i} className="absolute -translate-x-1/2" style={{ left: `${(x(i) / width) * 100}%` }}>
              {displayPoints[i].hour !== undefined ? formatHourLabel(displayPoints[i].hour as number) : displayPoints[i].label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// % change from `previous` to `current` -- null (not 0/Infinity) when there's
// no previous-period baseline to compare against, so a summary card with
// nothing to compare to shows no badge at all instead of a misleading "+100%".
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// A summary card's small vs-previous-period indicator -- green+up for a
// change in the direction that's good for the business, muted red+down
// otherwise. `higherIsBetter` flips that for a metric like expenses, where
// an increase is the bad direction.
function TrendChip({ pct, higherIsBetter = true }: { pct: number | null; higherIsBetter?: boolean }) {
  if (pct === null || pct === 0) return null;
  const isUp = pct > 0;
  const isGood = isUp === higherIsBetter;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        isGood
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
          : "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"
      }`}
    >
      {isUp ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {isUp ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  );
}

export default function AccountanceClient({
  brands,
  currentBrand,
  mode,
  week,
  month,
  quarter,
  year,
  fromDate,
  toDate,
  tab,
  summary,
  orders,
  reconciliation,
  expenses,
  cogsSummary,
  marginReport,
  wasteItems,
  wasteLog,
  previousPeriod,
}: {
  brands: Brand[];
  currentBrand: Brand;
  mode: RangeMode;
  week: string;
  month: string;
  quarter: string;
  year: string;
  fromDate: string;
  toDate: string;
  tab: AccountanceTab;
  summary: DailySalesSummary;
  orders: Order[];
  reconciliation: CashReconciliation | null;
  expenses: Expense[];
  cogsSummary: CogsSummary;
  marginReport: MarginReportRow[];
  wasteItems: StockPickerItem[];
  wasteLog: WasteLogEntry[];
  // Same shape as this period's own numbers, for the summary cards' small
  // vs-previous-period trend chips -- the immediately preceding period of
  // equal length (see previousPeriodRange in page.tsx).
  previousPeriod: {
    cashTotal: number;
    nonCashTotal: number;
    orderCount: number;
    total: number;
    expenseTotal: number;
    netProfit: number;
  };
}) {
  const router = useRouter();
  const [countedCash, setCountedCash] = useState(
    reconciliation ? String(reconciliation.counted_cash) : ""
  );
  const [notes, setNotes] = useState(reconciliation?.notes ?? "");
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  // Focused by the empty-state's "+ Add expense" shortcut link, so it jumps
  // straight into the form above instead of just pointing at it.
  const expenseDescRef = useRef<HTMLInputElement>(null);
  // Logging an expense picks its own business and day, independent of
  // whatever the page is currently filtered to -- so it works while looking
  // at "All Businesses", a whole month, or a whole year, not just a single
  // business on a single day. Seeded from the current view as a starting
  // point, not a constraint.
  const [expenseBrandId, setExpenseBrandId] = useState(
    currentBrand.id === ALL_BUSINESSES_ID ? brands[0].id : currentBrand.id
  );
  const [expenseDate, setExpenseDate] = useState(fromDate);
  // Keeps following the date filter above as the user changes it (switching
  // Day/Week/Month or stepping the date) -- without this, `expenseDate` only
  // ever captured `fromDate` once at mount, so navigating to a different day
  // left the form silently defaulted to whatever day the page first loaded
  // on. Skipped once the user has actually typed a different date on purpose
  // (logging a back-dated expense) -- resetting during render, React's
  // documented pattern for "adjusting state when a prop changes", rather
  // than in an effect.
  const [syncedFromDate, setSyncedFromDate] = useState(fromDate);
  if (syncedFromDate !== fromDate) {
    setSyncedFromDate(fromDate);
    setExpenseDate((prev) => (prev === syncedFromDate ? fromDate : prev));
  }
  // Set while editing an existing row -- the same form above the table is
  // reused for both adding and editing (populated from that row, "Add"
  // becomes "Save changes") instead of a separate edit form/modal.
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Day mode starts as one date box, not two identical ones -- "+ Range"
  // reveals the second (end) box only once the user actually wants a span.
  // Seeded from whether the incoming range already spans >1 day so a
  // bookmarked/shared multi-day link still opens with both boxes visible.
  const [showRangeEnd, setShowRangeEnd] = useState(fromDate !== toDate);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("");
  const [marginSearch, setMarginSearch] = useState("");
  const [marginCategoryFilter, setMarginCategoryFilter] = useState("");
  // Draft text for the Margin Report's inline Unit Cost / Selling Price
  // edits, keyed by product id -- same pattern as Stock's per-row editing.
  const [marginCostDrafts, setMarginCostDrafts] = useState<Record<string, string>>({});
  const [marginPriceDrafts, setMarginPriceDrafts] = useState<Record<string, string>>({});
  const [confirmDeleteExpense, setConfirmDeleteExpense] = useState<{
    id: string;
    description: string;
  } | null>(null);

  // Hides the app shell's scrollbar while this page is mounted -- scrolling
  // itself still works (wheel/keyboard/touch), only the visible track/thumb
  // is gone. Scoped to #app-scroll-area (the one scroll container shared by
  // every page under (app)/layout.tsx) via a class toggled at runtime, and
  // removed on unmount, so navigating to any other page gets its normal
  // scrollbar back.
  useEffect(() => {
    const el = document.getElementById("app-scroll-area");
    el?.classList.add("no-scrollbar");
    return () => {
      el?.classList.remove("no-scrollbar");
    };
  }, []);

  // Every navigation goes through this -- it fills in whichever of
  // from/to/week/month/quarter/year the target mode actually needs from
  // current state, so switching brand, mode, tab, or stepping a
  // week/month/quarter/year never has to repeat the other params by hand
  // (or accidentally drop one). `tab` always carries over unless overridden,
  // so changing the date filter never bounces you back to the default tab.
  function urlFor(overrides: {
    brand?: string;
    mode?: RangeMode;
    from?: string;
    to?: string;
    week?: string;
    month?: string;
    quarter?: string;
    year?: string;
    tab?: AccountanceTab;
  }) {
    const targetMode = overrides.mode ?? mode;
    const params = new URLSearchParams();
    params.set("brand", overrides.brand ?? currentBrand.id);
    params.set("mode", targetMode);
    if (targetMode === "week") params.set("week", overrides.week ?? week);
    else if (targetMode === "month") params.set("month", overrides.month ?? month);
    else if (targetMode === "quarter") params.set("quarter", overrides.quarter ?? quarter);
    else if (targetMode === "year") params.set("year", overrides.year ?? year);
    else {
      params.set("from", overrides.from ?? fromDate);
      params.set("to", overrides.to ?? toDate);
    }
    params.set("tab", overrides.tab ?? tab);
    return `/accountance?${params.toString()}`;
  }

  function switchBrand(brandId: string) {
    router.push(urlFor({ brand: brandId }));
  }

  function switchMode(newMode: RangeMode) {
    router.push(urlFor({ mode: newMode }));
  }

  function switchTab(newTab: AccountanceTab) {
    router.push(urlFor({ tab: newTab }));
  }

  // A single date input clamps its own range (max/min against the other
  // end) so this never has to correct an inverted from > to itself.
  function switchDates(newFrom: string, newTo: string) {
    router.push(urlFor({ mode: "day", from: newFrom, to: newTo }));
  }

  function switchWeek(newWeek: string) {
    router.push(urlFor({ mode: "week", week: newWeek }));
  }

  function stepWeek(delta: number) {
    const d = new Date(`${week}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 7 * delta);
    switchWeek(d.toISOString().slice(0, 10));
  }

  function switchMonth(newMonth: string) {
    router.push(urlFor({ mode: "month", month: newMonth }));
  }

  function stepMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    switchMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  function switchQuarter(newQuarter: string) {
    router.push(urlFor({ mode: "quarter", quarter: newQuarter }));
  }

  function stepQuarter(delta: number) {
    const [y, q] = quarter.split("-Q").map(Number);
    const zeroBased = (q - 1) + delta;
    const yearOffset = Math.floor(zeroBased / 4);
    const newQ = ((zeroBased % 4) + 4) % 4;
    switchQuarter(`${y + yearOffset}-Q${newQ + 1}`);
  }

  function switchYear(newYear: string) {
    router.push(urlFor({ mode: "year", year: newYear }));
  }

  function stepYear(delta: number) {
    switchYear(String(Number(year) + delta));
  }

  const isSingleDay = mode === "day" && fromDate === toDate;
  const rangeLabel =
    mode === "week"
      ? `${fromDate} to ${toDate}`
      : mode === "month"
        ? month
        : mode === "quarter"
          ? quarter
          : mode === "year"
            ? year
            : isSingleDay
              ? fromDate
              : `${fromDate} to ${toDate}`;

  const expenseTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const wastePromoTotal = cogsSummary.wasteCost + cogsSummary.promotionCost;
  // Gross profit = revenue - COGS; net profit also backs out operating
  // expenses and the cost of waste/spillage/comps -- see the plan's
  // confirmed decision on folding waste/promo into net profit.
  const grossProfit = summary.total - cogsSummary.totalCogs;
  const netProfit = grossProfit - expenseTotal - wastePromoTotal;
  const grossMarginPct = summary.total === 0 ? null : (grossProfit / summary.total) * 100;
  // Flags a card as "high" when waste/promo cost eats more than 5% of
  // whichever base it's judged against -- COGS for waste, revenue for promo.
  const wasteRatio = cogsSummary.totalCogs > 0 ? cogsSummary.wasteCost / cogsSummary.totalCogs : 0;
  const promoRatio = summary.total > 0 ? cogsSummary.promotionCost / summary.total : 0;

  const filteredExpenses = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    return expenses.filter((e) => {
      if (expenseCategoryFilter && (e.category ?? "") !== expenseCategoryFilter) return false;
      if (q && !e.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [expenses, expenseSearch, expenseCategoryFilter]);
  const filteredExpenseTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
  const expenseCategories = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.category).filter((c): c is string => Boolean(c)))).sort(),
    [expenses]
  );
  const isExpenseFilterActive = expenseSearch.trim() !== "" || expenseCategoryFilter !== "";

  const filteredMarginReport = useMemo(() => {
    const q = marginSearch.trim().toLowerCase();
    return marginReport.filter((r) => {
      if (marginCategoryFilter && (r.categoryName ?? "") !== marginCategoryFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [marginReport, marginSearch, marginCategoryFilter]);
  const marginCategories = useMemo(
    () =>
      Array.from(new Set(marginReport.map((r) => r.categoryName).filter((c): c is string => Boolean(c)))).sort(),
    [marginReport]
  );
  // Feeds both the top-of-report "N products are missing a cost price" bar
  // and the bulk-fill modal -- unaffected by the search/category filter, so
  // the count and the modal's list always match the whole range.
  const missingCostRows = useMemo(() => marginReport.filter((r) => r.unitCost === null), [marginReport]);

  // Reports tab's Revenue vs Expenses chart -- hourly for a single day
  // (orders carry a real timestamp; expenses only ever carry a date, so
  // there's no expense line to draw hourly), monthly for a full year (a
  // year's worth of daily points is hundreds of unreadable thin spikes),
  // daily for anything in between.
  const chartGranularity: ChartGranularity = isSingleDay ? "hour" : mode === "year" ? "month" : "day";
  const timeSeries = useMemo(() => {
    if (chartGranularity === "hour") return buildHourlySeries(orders);
    if (chartGranularity === "month") return buildMonthlySeries(orders, expenses, year);
    return buildDailySeries(orders, expenses, fromDate, toDate);
  }, [chartGranularity, orders, expenses, fromDate, toDate, year]);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  // Header's "Avg Revenue / Peak" callout -- always over the *whole* selected
  // range, even while a brush zoom (inside the chart itself) is focused on
  // part of it, so these numbers don't shift under the user as they zoom.
  const chartStats = useMemo(() => {
    if (timeSeries.length === 0) return null;
    const total = timeSeries.reduce((sum, p) => sum + p.revenue, 0);
    const peak = timeSeries.reduce((best, p) => (p.revenue > best.revenue ? p : best), timeSeries[0]);
    return { avg: total / timeSeries.length, peak };
  }, [timeSeries]);

  // Which row's Unit Cost / Selling Price are currently shown as inputs --
  // one at a time, everything else stays a compact chip/value so the table
  // reads cleanly instead of every row carrying two empty boxes.
  const [editingMarginId, setEditingMarginId] = useState<string | null>(null);
  const [bulkCostModalOpen, setBulkCostModalOpen] = useState(false);
  const [wasteModalOpen, setWasteModalOpen] = useState(false);
  const [wasteLogOpen, setWasteLogOpen] = useState(false);
  const [editingWaste, setEditingWaste] = useState<WasteLogEntry | null>(null);
  const [confirmDeleteWaste, setConfirmDeleteWaste] = useState<WasteLogEntry | null>(null);

  function startMarginEdit(productId: string) {
    setError(null);
    setEditingMarginId(productId);
  }

  function cancelMarginEdit(productId: string) {
    setMarginCostDrafts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setMarginPriceDrafts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setEditingMarginId(null);
  }

  // Saves whichever of Unit Cost / Selling Price the row's drafts actually
  // changed. Setting a unit cost also backfills COGS for that product's
  // already-sold lines that never had a cost recorded (see
  // setProductCostAction) -- so a product added before cost tracking existed
  // stops showing "No cost price" once its cost is filled in. A selling-price
  // change only applies going forward -- past lines' revenue was already
  // recorded at sale time and isn't rewritten.
  function saveMarginRow(r: MarginReportRow) {
    const costRaw = marginCostDrafts[r.productId];
    const priceRaw = marginPriceDrafts[r.productId];
    const trimmedCost = costRaw?.trim();
    const costPrice = trimmedCost === undefined ? undefined : trimmedCost === "" ? null : parseFloat(trimmedCost);
    const price = priceRaw === undefined ? undefined : parseFloat(priceRaw);

    if (costPrice !== undefined && costPrice !== null && (Number.isNaN(costPrice) || costPrice < 0)) {
      setError("Unit cost cannot be negative");
      return;
    }
    if (price !== undefined && (Number.isNaN(price) || price < 0)) {
      setError("Selling price cannot be negative");
      return;
    }
    setError(null);

    const costChanged = costPrice !== undefined && costPrice !== r.unitCost;
    const priceChanged = price !== undefined && price !== r.sellingPrice;
    if (!costChanged && !priceChanged) {
      cancelMarginEdit(r.productId);
      return;
    }

    startTransition(async () => {
      try {
        if (costChanged) await setProductCostAction({ productId: r.productId, costPrice: costPrice ?? null });
        if (priceChanged) await setProductPriceAction({ productId: r.productId, price: price as number });
        router.refresh();
      } finally {
        cancelMarginEdit(r.productId);
      }
    });
  }

  function saveReconciliation() {
    const counted = parseFloat(countedCash);
    if (Number.isNaN(counted)) {
      setError("Enter a counted cash amount");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await saveReconciliationAction({
          brandId: currentBrand.id,
          date: fromDate,
          countedCash: counted,
          expectedCash: summary.cashTotal,
          expectedBankQr: summary.nonCashTotal,
          notes: notes.trim() || undefined,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save reconciliation");
      }
    });
  }

  function resetExpenseForm() {
    setEditingExpenseId(null);
    setExpenseDesc("");
    setExpenseAmount("");
    setExpenseCategory("");
  }

  function startEditExpense(expense: Expense) {
    setEditingExpenseId(expense.id);
    setExpenseBrandId(expense.brand_id);
    setExpenseDate(expense.expense_date);
    setExpenseDesc(expense.description);
    setExpenseAmount(String(expense.amount));
    setExpenseCategory(expense.category ?? "");
    setError(null);
  }

  function saveExpense() {
    const amount = parseFloat(expenseAmount);
    if (!expenseDesc.trim() || Number.isNaN(amount) || amount <= 0) {
      setError("Enter a description and a positive amount");
      return;
    }
    setError(null);
    const input = {
      brandId: expenseBrandId,
      description: expenseDesc.trim(),
      amount,
      category: expenseCategory.trim() || undefined,
      date: expenseDate,
    };
    startTransition(async () => {
      try {
        if (editingExpenseId) await updateExpenseAction(editingExpenseId, input);
        else await addExpenseAction(input);
        resetExpenseForm();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save expense");
      }
    });
  }

  function handleExpenseDeleted(id: string) {
    if (editingExpenseId === id) resetExpenseForm();
  }

  const fileDateLabel =
    mode === "week" || mode === "month" || mode === "quarter" || mode === "year"
      ? rangeLabel
      : `${fromDate}${isSingleDay ? "" : `_to_${toDate}`}`;

  function exportCsv() {
    const lines: string[] = [];
    lines.push(`Daily report,${currentBrand.name},${rangeLabel}`);
    lines.push("");
    lines.push("Sales");
    lines.push("Order ID,Payment Method,Total,Paid At");
    for (const o of orders) {
      lines.push(`${o.id},${o.payment_method ?? ""},${o.total},${o.paid_at ?? ""}`);
    }
    lines.push("");
    for (const b of summary.paymentBreakdown) {
      lines.push(`${PAYMENT_METHOD_LABELS[b.method]} total,${b.total}`);
    }
    lines.push(`Sales total,${summary.total}`);
    lines.push("");
    lines.push("Expenses");
    lines.push("Description,Category,Amount");
    for (const e of expenses) {
      lines.push(`"${e.description.replace(/"/g, '""')}",${e.category ?? ""},${e.amount}`);
    }
    lines.push(`Expense total,${expenseTotal}`);
    lines.push("");
    lines.push(`Net (sales - expenses),${summary.total - expenseTotal}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentBrand.slug}-${fileDateLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    exportAccountancePdf(`${currentBrand.slug}-${fileDateLabel}`, {
      businessName: currentBrand.name,
      rangeLabel,
      paymentBreakdown: summary.paymentBreakdown.map((b) => ({
        label: PAYMENT_METHOD_LABELS[b.method],
        total: b.total,
      })),
      orderCount: orders.length,
      total: summary.total,
      expenses: expenses.map((e) => ({
        description: e.description,
        category: e.category,
        amount: e.amount,
      })),
      expenseTotal,
    });
  }

  const variance = reconciliation ? reconciliation.variance : null;
  // Reconciling a till count, and logging a new expense, both need one
  // specific business on one specific day -- "All Businesses" has no single
  // cash drawer, addExpenseAction/saveReconciliationAction both take one
  // brandId, and a multi-day range has no single day to file either against.
  // Both actions are disabled (not hidden -- the combined stats/expense log
  // still read fine) until a single business and a single day are picked.
  const isAllBusinesses = currentBrand.id === ALL_BUSINESSES_ID;
  function brandNameFor(brandId: string) {
    return brands.find((b) => b.id === brandId)?.name ?? "—";
  }

  return (
    <div className="p-6">
      {/* Top Bar -- title, business + Day/Month/Year + the date control that
          mode needs, and the export actions, all in one row so "what am I
          looking at" and "what can I do with it" live together instead of
          being split across a header row and a separate filter row. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-black/[.08] p-3 dark:border-white/[.145]">
        <h1 className="mr-1 text-lg font-medium">Accounting</h1>
        <select
          className="rounded border border-black/[.15] bg-card px-3 py-1.5 text-sm text-foreground dark:border-white/[.2]"
          value={currentBrand.id}
          onChange={(e) => switchBrand(e.target.value)}
        >
          <option value={ALL_BUSINESSES_ID}>All Businesses</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        {/* Day/Week/Month/Quarter/Year -- Day keeps the free-form From/To
            range below (also covers "Custom Date Range"); the rest swap in
            a single stepped picker that always covers that whole calendar
            unit. */}
        <div className="inline-flex rounded-full border border-black/[.15] p-0.5 dark:border-white/[.2]">
          {(["day", "week", "month", "quarter", "year"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                mode === m ? "bg-brand text-black" : "text-zinc-500 hover:text-foreground"
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
              onChange={(e) => switchDates(e.target.value, showRangeEnd ? toDate : e.target.value)}
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
            <span className="min-w-40 text-center text-sm">{fromDate} – {toDate}</span>
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

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportPdf}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black hover:brightness-95"
          >
            Save as PDF
          </button>
          <button
            onClick={exportCsv}
            className="rounded-full border border-black/[.15] px-4 py-1.5 text-sm dark:border-white/[.2]"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Secondary Bar: sub-navigation for the 4 Accountance views -- mirrors
          the sidebar's Accountance sub-links, so a tab can be reached either
          way and both stay in sync via the same `tab` searchParam. */}
      <div className="mb-6 inline-flex flex-wrap gap-1 rounded-full border border-black/[.08] bg-black/[.02] p-1 dark:border-white/[.145] dark:bg-white/[.03]">
        {(Object.keys(TAB_LABELS) as AccountanceTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            aria-pressed={tab === t}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              tab === t ? "bg-brand text-black shadow-sm" : "text-zinc-500 hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Banknote className="size-3.5" />
              Cash sales
            </span>
            <TrendChip pct={pctChange(summary.cashTotal, previousPeriod.cashTotal)} />
          </div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.cashTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <CreditCard className="size-3.5" />
              Non-cash sales
            </span>
            <TrendChip pct={pctChange(summary.nonCashTotal, previousPeriod.nonCashTotal)} />
          </div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.nonCashTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <ShoppingBag className="size-3.5" />
              Orders
            </span>
            <TrendChip pct={pctChange(orders.length, previousPeriod.orderCount)} />
          </div>
          <div className="mt-1 text-xl font-semibold">{orders.length}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="size-3.5" />
              Total revenue
            </span>
            <TrendChip pct={pctChange(summary.total, previousPeriod.total)} />
          </div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(summary.total)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Wallet className="size-3.5" />
              Total expenses
            </span>
            <TrendChip pct={pctChange(expenseTotal, previousPeriod.expenseTotal)} higherIsBetter={false} />
          </div>
          <div className="mt-1 text-xl font-semibold">{formatMoney(expenseTotal)}</div>
        </div>
        <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <PiggyBank className="size-3.5" />
              {netProfit < 0 ? "Net Loss" : "Net profit"}
            </span>
            {/* A "+X%" badge here means the *loss shrank* (or profit grew) vs
                the previous period -- still worth showing, but never on its
                own next to a negative number without the red "Net Loss"
                label above making clear the period itself was a loss. */}
            <TrendChip pct={pctChange(netProfit, previousPeriod.netProfit)} />
          </div>
          <div
            className={`mt-1 text-xl font-semibold ${netProfit < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
          >
            {formatMoney(netProfit)}
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="mt-6 space-y-6">
        {tab === "reconciliation" && (
        <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <h2 className="font-medium">Cash reconciliation</h2>
          {isAllBusinesses ? (
            <>
              <p className="mt-1 text-xs text-zinc-500">
                There&apos;s no single cash drawer across all 3 businesses -- pick one to reconcile:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {brands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => switchBrand(b.id)}
                    className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.08]"
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </>
          ) : !isSingleDay ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xs text-zinc-500">
                Cash is counted once per day -- narrow the date range above to a single day to
                reconcile it, or
              </p>
              <button
                type="button"
                onClick={() => switchDates(todayIso(), todayIso())}
                className="text-xs font-medium text-brand hover:underline"
              >
                jump to today
              </button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-xs text-zinc-500">
                Expected cash from sales: {formatMoney(summary.cashTotal)}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <label className="text-xs text-zinc-500">Counted cash</label>
                <input
                  type="number"
                  step="0.01"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                />
                <label className="text-xs text-zinc-500">Notes (optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                />
                <button
                  disabled={isPending}
                  onClick={saveReconciliation}
                  className="mt-1 self-start rounded-full bg-black px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
                >
                  Save reconciliation
                </button>
              </div>
              {variance !== null && (
                <p
                  className={`mt-3 text-sm font-medium ${
                    variance === 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  Variance: {variance > 0 ? "+" : ""}
                  {formatMoney(variance)}{" "}
                  {variance === 0 ? "(balanced)" : variance > 0 ? "(over)" : "(short)"}
                </p>
              )}
            </>
          )}
        </section>
        )}

        {tab === "expenses" && (
        <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <h2 className="font-medium">Expense log</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {isAllBusinesses || !isSingleDay
              ? "Showing expenses for the filter above -- logging a new one below works for any business and day, regardless of that filter."
              : "Log an expense for any business and day below -- not just the one currently filtered above."}
          </p>
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Vendor &amp; accounts-payable tracking and recurring expense automation are coming in
              a later update -- for now this logs one-off expenses only.
            </span>
          </div>
          {/* Date -> Business -> Description -> Category -> Amount -> Add,
              the order someone actually fills a receipt in. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <select
              value={expenseBrandId}
              onChange={(e) => setExpenseBrandId(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input
              ref={expenseDescRef}
              type="text"
              placeholder="Description"
              value={expenseDesc}
              onChange={(e) => setExpenseDesc(e.target.value)}
              className="min-w-[10rem] flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Category (optional)"
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              className="w-36 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Amount"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className="w-28 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <button
              disabled={isPending}
              onClick={saveExpense}
              className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-black hover:brightness-95 disabled:opacity-40"
            >
              {editingExpenseId ? "Save changes" : "+ Add Expense"}
            </button>
            {editingExpenseId && (
              <button
                type="button"
                disabled={isPending}
                onClick={resetExpenseForm}
                className="rounded px-3 py-1.5 text-sm text-zinc-500 hover:text-foreground disabled:opacity-40"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Search + category filter -- narrows the table below without
              touching the page's own business/date filter above, so finding
              an old expense doesn't require re-filtering the whole page. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Search description..."
              value={expenseSearch}
              onChange={(e) => setExpenseSearch(e.target.value)}
              className="flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            />
            <select
              value={expenseCategoryFilter}
              onChange={(e) => setExpenseCategoryFilter(e.target.value)}
              className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
            >
              <option value="">All categories</option>
              {expenseCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
                  <th className="py-2 pr-3 text-center font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Business</th>
                  <th className="py-2 pr-3 font-medium">Category</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th className="relative py-2 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
                {filteredExpenses.map((e) => (
                  <tr key={e.id} className={editingExpenseId === e.id ? "bg-brand/10" : undefined}>
                    <td className="py-2 pr-3 text-center whitespace-nowrap text-zinc-500">{e.expense_date}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{brandNameFor(e.brand_id)}</td>
                    <td className="py-2 pr-3 text-zinc-500">{e.category || "—"}</td>
                    <td className="py-2 pr-3">{e.description}</td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums">{formatMoney(e.amount)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => startEditExpense(e)}
                        aria-label={`Edit ${e.description}`}
                        className="mr-2 text-zinc-400 hover:text-foreground"
                      >
                        <Pencil className="inline size-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteExpense({ id: e.id, description: e.description })}
                        aria-label={`Delete ${e.description}`}
                        className="text-zinc-400 hover:text-red-500"
                      >
                        <Trash2 className="inline size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-zinc-500">
                      <div className="flex flex-col items-center gap-2">
                        <Receipt className="size-6 text-zinc-400" />
                        {expenses.length === 0 ? (
                          <>
                            <span className="font-medium text-foreground">
                              No expenses logged for {isSingleDay ? "this day" : "this date range"}
                            </span>
                            <button
                              type="button"
                              onClick={() => expenseDescRef.current?.focus()}
                              className="text-xs font-medium text-brand hover:underline"
                            >
                              + Add an expense above
                            </button>
                          </>
                        ) : (
                          <span>No expenses match this search/filter.</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-between rounded-b-lg border-t-2 border-black/[.15] bg-black/[.02] px-3 py-2.5 text-sm font-medium dark:border-white/[.25] dark:bg-white/[.04]">
            <span>{isExpenseFilterActive ? "Total (filtered)" : "Total expenses"}</span>
            <span className="tabular-nums">
              {formatMoney(isExpenseFilterActive ? filteredExpenseTotal : expenseTotal)}
            </span>
          </div>
        </section>
        )}

        {tab === "reports" && (
          <div className="flex flex-col gap-6">
            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-medium">
                    {chartGranularity === "hour"
                      ? "Hourly Revenue"
                      : chartGranularity === "month"
                        ? "Monthly Revenue vs Expenses"
                        : "Daily Revenue vs Expenses"}
                  </h2>
                  {chartStats && (
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {GRANULARITY_LABEL[chartGranularity]} avg revenue:{" "}
                      <span className="font-medium text-foreground">{formatMoney(chartStats.avg)}</span>
                      {" · "}
                      Peak {GRANULARITY_UNIT[chartGranularity]}:{" "}
                      <span className="font-medium text-foreground">{formatMoney(chartStats.peak.revenue)}</span>{" "}
                      {chartGranularity === "hour" ? "at" : "on"} {chartStats.peak.label}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full bg-green-600" aria-hidden />
                      Revenue
                    </span>
                    {chartGranularity !== "hour" && (
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-red-600" aria-hidden />
                        Expenses
                      </span>
                    )}
                  </div>
                  <div className="inline-flex rounded-full border border-black/[.15] p-0.5 dark:border-white/[.2]">
                    {(["line", "bar"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setChartType(t)}
                        aria-pressed={chartType === t}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                          chartType === t ? "bg-brand text-black" : "text-zinc-500 hover:text-foreground"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {summary.total === 0 && expenseTotal === 0 ? (
                <div className="mt-2 flex flex-col items-center gap-2 py-10 text-center text-sm text-zinc-500">
                  <BarChart3 className="size-6 text-zinc-400" />
                  <span className="font-medium text-foreground">No activity for {rangeLabel}</span>
                  <span className="text-xs text-zinc-500">
                    Select a different date or date range to view sales and expense trends.
                  </span>
                </div>
              ) : (
                <RevenueExpenseChart
                  points={timeSeries}
                  showExpense={chartGranularity !== "hour"}
                  granularity={chartGranularity}
                  chartType={chartType}
                />
              )}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
                <h2 className="font-medium">Profit &amp; Loss</h2>
                <p className="mt-1 text-xs text-zinc-500">{rangeLabel}</p>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Gross sales</span>
                    <span className="font-medium tabular-nums">{formatMoney(summary.total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">
                      Cost of goods sold
                      {cogsSummary.hasUnknownCost && (
                        <span className="ml-1 text-[11px] text-amber-500">
                          ⚠ incomplete -- some items have no cost price
                        </span>
                      )}
                    </span>
                    <span className="font-medium tabular-nums">-{formatMoney(cogsSummary.totalCogs)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-zinc-500">Gross profit</span>
                    <span className="tabular-nums">{formatMoney(grossProfit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Operating expenses</span>
                    <span className="font-medium tabular-nums">-{formatMoney(expenseTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Waste / promo cost</span>
                    <span className="font-medium tabular-nums">-{formatMoney(wastePromoTotal)}</span>
                  </div>
                  <div className="flex justify-between border-t border-black/[.08] pt-2 text-base font-semibold dark:border-white/[.145]">
                    <span>{netProfit < 0 ? "Net Loss" : "Net profit"}</span>
                    <span className={`tabular-nums ${netProfit < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
                      {formatMoney(netProfit)}
                    </span>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
                <h2 className="font-medium">Payment method breakdown</h2>
                {summary.paymentBreakdown.length === 0 ? (
                  <div className="mt-2 flex flex-col items-center gap-2 py-8 text-center text-sm text-zinc-500">
                    <BarChart3 className="size-6 text-zinc-400" />
                    <span className="font-medium text-foreground">No sales logged for this period</span>
                    <span className="text-xs text-zinc-500">
                      Select a different date or date range to view the payment mix.
                    </span>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-5">
                    <PaymentDonut
                      segments={summary.paymentBreakdown.map((b) => ({
                        color: PAYMENT_METHOD_COLORS[b.method],
                        value: b.total,
                      }))}
                    />
                    <ul className="flex flex-1 flex-col gap-1.5 text-sm">
                      {summary.paymentBreakdown.map((b) => (
                        <li key={b.method} className="flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: PAYMENT_METHOD_COLORS[b.method] }}
                            aria-hidden
                          />
                          <span>{PAYMENT_METHOD_LABELS[b.method]}</span>
                          <span className="text-xs text-zinc-500">
                            {((b.total / summary.total) * 100).toFixed(0)}%
                          </span>
                          <span className="ml-auto font-medium tabular-nums">{formatMoney(b.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {tab === "cogs" && (
          <div className="flex flex-col gap-6">
            {cogsSummary.hasUnknownCost && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                ⚠ Some items sold in this period have no cost price recorded -- the totals below
                only include what&apos;s known. Add the missing costs in the Margin Report below to
                complete them.
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-medium text-foreground">Waste tracking</h2>
                <span
                  title={
                    currentBrand.id === ALL_BUSINESSES_ID
                      ? "Switch to a single business to log waste."
                      : "Spoiled, damaged, or expired stock -- logs a stock adjustment and counts toward Waste below."
                  }
                >
                  <Info className="size-3.5 text-zinc-400" />
                </span>
              </div>
              <button
                type="button"
                onClick={() => setWasteModalOpen(true)}
                disabled={currentBrand.id === ALL_BUSINESSES_ID}
                className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-sm font-medium text-black shadow-sm hover:brightness-95 disabled:opacity-40 disabled:shadow-none"
              >
                + Add waste item
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Receipt className="size-3.5" />
                  Total COGS
                </div>
                <div className="mt-1 text-xl font-semibold">{formatMoney(cogsSummary.totalCogs)}</div>
              </div>
              <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <TrendingUp className="size-3.5" />
                  Gross profit
                </div>
                <div className="mt-1 text-xl font-semibold">{formatMoney(grossProfit)}</div>
              </div>
              <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <Percent className="size-3.5" />
                    Gross margin %
                  </span>
                  {grossMarginPct !== null &&
                    (grossMarginPct >= 40 ? (
                      <TrendBadge tone="positive">Healthy</TrendBadge>
                    ) : grossMarginPct < 15 ? (
                      <TrendBadge tone="negative">Low</TrendBadge>
                    ) : null)}
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {grossMarginPct === null ? "—" : `${grossMarginPct.toFixed(1)}%`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWasteLogOpen((v) => !v)}
                className="rounded-lg border border-black/[.08] bg-card p-4 text-left shadow-sm transition-colors hover:bg-black/[.02] dark:border-white/[.145] dark:hover:bg-white/[.04]"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <Trash2 className="size-3.5" />
                    Waste ({wasteLog.length})
                  </span>
                  <ChevronDown
                    className={`size-3.5 shrink-0 transition-transform ${wasteLogOpen ? "rotate-180" : ""}`}
                  />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xl font-semibold">{formatMoney(cogsSummary.wasteCost)}</span>
                  {cogsSummary.wasteCost > 0 && wasteRatio > 0.05 && (
                    <TrendBadge tone="negative">High</TrendBadge>
                  )}
                </div>
              </button>
              <div className="rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]">
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <Tag className="size-3.5" />
                    Promotions
                  </span>
                  {cogsSummary.promotionCost > 0 && promoRatio > 0.05 && (
                    <TrendBadge tone="negative">High</TrendBadge>
                  )}
                </div>
                <div className="mt-1 text-xl font-semibold">{formatMoney(cogsSummary.promotionCost)}</div>
              </div>
            </div>

            {wasteLogOpen && (
              <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
                <h2 className="font-medium">Waste log</h2>
                <p className="mt-1 text-xs text-zinc-500">{rangeLabel}</p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 pr-3 font-medium">Product</th>
                        <th className="py-2 pr-3 text-right font-medium">Qty wasted</th>
                        <th className="py-2 pr-3 font-medium">Note</th>
                        <th className="py-2 pr-3 text-right font-medium">Price</th>
                        <th className="py-2 pr-3 text-right font-medium">Total Cost</th>
                        <th className="py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
                      {wasteLog.map((w) => (
                        <tr key={w.id}>
                          <td className="py-2 pr-3 text-zinc-500">
                            {new Date(w.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2 pr-3">{w.productName}</td>
                          <td className="py-2 pr-3 text-right">{w.quantity}</td>
                          <td className="py-2 pr-3 text-zinc-500">{w.reason}</td>
                          <td className="py-2 pr-3 text-right">
                            {w.unitCost === null ? (
                              <span className="text-zinc-400">—</span>
                            ) : (
                              formatMoney(w.unitCost)
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            {w.costImpact === null ? (
                              <span className="text-zinc-400">— no cost price</span>
                            ) : (
                              formatMoney(w.costImpact)
                            )}
                          </td>
                          <td className="py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                title="Edit"
                                onClick={() => setEditingWaste(w)}
                                className="rounded p-1 text-zinc-500 hover:bg-black/[.06] dark:hover:bg-white/[.1]"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Delete"
                                onClick={() => setConfirmDeleteWaste(w)}
                                className="rounded p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {wasteLog.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-zinc-500">
                            No waste logged for this range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <h2 className="font-medium">Margin Report</h2>
              <p className="mt-1 text-xs text-zinc-500">{rangeLabel}</p>

              {missingCostRows.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <span className="flex items-center gap-2">
                    <TriangleAlert className="size-4 shrink-0" />
                    {missingCostRows.length} product{missingCostRows.length === 1 ? "" : "s"}{" "}
                    {missingCostRows.length === 1 ? "is" : "are"} missing a cost price
                  </span>
                  <button
                    type="button"
                    onClick={() => setBulkCostModalOpen(true)}
                    className="shrink-0 rounded-full border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
                  >
                    Add all costs
                  </button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Search product..."
                  value={marginSearch}
                  onChange={(e) => setMarginSearch(e.target.value)}
                  className="flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                />
                <select
                  value={marginCategoryFilter}
                  onChange={(e) => setMarginCategoryFilter(e.target.value)}
                  className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                >
                  <option value="">All categories</option>
                  {marginCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
                      <th className="py-2 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 text-right font-medium">Units Sold</th>
                      <th className="py-2 pr-3 text-right font-medium">Revenue</th>
                      <th className="py-2 pr-3 text-right font-medium">Unit Cost</th>
                      <th className="py-2 pr-3 text-right font-medium">Selling Price</th>
                      <th className="py-2 pr-3 text-right font-medium">Total COGS</th>
                      <th className="py-2 pr-3 text-right font-medium">Gross Profit</th>
                      <th className="py-2 text-right font-medium">Gross Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
                    {filteredMarginReport.map((r) => {
                      const editing = editingMarginId === r.productId;
                      const costValue =
                        marginCostDrafts[r.productId] ?? (r.unitCost === null ? "" : String(r.unitCost));
                      const priceValue = marginPriceDrafts[r.productId] ?? String(r.sellingPrice);
                      return (
                      <tr key={r.productId} className={editing ? "bg-blue-50 dark:bg-blue-950/30" : undefined}>
                        <td className="py-2 pr-3">{r.name}</td>
                        <td className="py-2 pr-3 text-right">{r.unitsSold}</td>
                        <td className="py-2 pr-3 text-right">{formatMoney(r.revenue)}</td>
                        {editing ? (
                          <>
                            <td className="py-2 pr-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-zinc-400">$</span>
                                <input
                                  autoFocus
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  placeholder="—"
                                  value={costValue}
                                  onChange={(e) =>
                                    setMarginCostDrafts((prev) => ({ ...prev, [r.productId]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveMarginRow(r);
                                    if (e.key === "Escape") cancelMarginEdit(r.productId);
                                  }}
                                  className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm dark:border-white/[.2]"
                                />
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-zinc-400">$</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={priceValue}
                                  onChange={(e) =>
                                    setMarginPriceDrafts((prev) => ({ ...prev, [r.productId]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveMarginRow(r);
                                    if (e.key === "Escape") cancelMarginEdit(r.productId);
                                  }}
                                  className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm dark:border-white/[.2]"
                                />
                                <button
                                  type="button"
                                  title="Save"
                                  onClick={() => saveMarginRow(r)}
                                  className="rounded p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/40"
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title="Cancel"
                                  onClick={() => cancelMarginEdit(r.productId)}
                                  className="rounded p-1 text-zinc-500 hover:bg-black/[.06] dark:hover:bg-white/[.1]"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 pr-3 text-right">
                              {r.unitCost === null ? (
                                <button
                                  type="button"
                                  onClick={() => startMarginEdit(r.productId)}
                                  className="rounded-full border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
                                >
                                  + Add cost price
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startMarginEdit(r.productId)}
                                  className="rounded px-1 py-0.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]"
                                >
                                  {formatMoney(r.unitCost)}
                                </button>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-right">
                              <button
                                type="button"
                                onClick={() => startMarginEdit(r.productId)}
                                className="rounded px-1 py-0.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]"
                              >
                                {formatMoney(r.sellingPrice)}
                              </button>
                            </td>
                          </>
                        )}
                        <td className="py-2 pr-3 text-right">
                          {r.totalCogs === null ? (
                            <span className="text-amber-500">⚠ No cost price</span>
                          ) : (
                            formatMoney(r.totalCogs)
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {r.grossProfit === null ? "—" : formatMoney(r.grossProfit)}
                        </td>
                        <td className="py-2 text-right">
                          {r.grossMarginPct === null ? (
                            "—"
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <span
                                className={`font-medium ${
                                  r.grossMarginPct < 0
                                    ? "text-red-600 dark:text-red-400"
                                    : r.grossMarginPct < 20
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-green-600 dark:text-green-400"
                                }`}
                              >
                                {r.grossMarginPct.toFixed(1)}%
                              </span>
                              <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.1]">
                                <div
                                  className={`h-full rounded-full ${
                                    r.grossMarginPct < 0
                                      ? "bg-red-500"
                                      : r.grossMarginPct < 20
                                        ? "bg-amber-500"
                                        : "bg-green-500"
                                  }`}
                                  style={{ width: `${Math.max(0, Math.min(100, r.grossMarginPct))}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                    {filteredMarginReport.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-sm text-zinc-500">
                          <div className="flex flex-col items-center gap-2">
                            <SearchX className="size-6 text-zinc-400" />
                            {marginReport.length === 0 ? (
                              <>
                                <span className="font-medium text-foreground">
                                  No sales logged for {isSingleDay ? "this day" : "this date range"}
                                </span>
                                <span className="text-xs text-zinc-500">
                                  Select a different date or date range to view sales and margin
                                  performance.
                                </span>
                              </>
                            ) : (
                              <span>No products match this search/filter.</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>

      {confirmDeleteExpense && (
        <DeleteExpenseDialog
          expenseId={confirmDeleteExpense.id}
          description={confirmDeleteExpense.description}
          onClose={() => setConfirmDeleteExpense(null)}
          onDeleted={() => handleExpenseDeleted(confirmDeleteExpense.id)}
        />
      )}

      {bulkCostModalOpen && (
        <BulkAddCostPriceModal rows={missingCostRows} onClose={() => setBulkCostModalOpen(false)} />
      )}

      {wasteModalOpen && (
        <AddWasteItemModal items={wasteItems} defaultDate={fromDate} onClose={() => setWasteModalOpen(false)} />
      )}

      {editingWaste && (
        <EditWasteLogModal entry={editingWaste} onClose={() => setEditingWaste(null)} />
      )}

      {confirmDeleteWaste && (
        <DeleteWasteLogDialog
          entryId={confirmDeleteWaste.id}
          productName={confirmDeleteWaste.productName}
          quantity={confirmDeleteWaste.quantity}
          onClose={() => setConfirmDeleteWaste(null)}
        />
      )}
    </div>
  );
}
