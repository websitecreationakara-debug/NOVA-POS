"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, Plus, Receipt, ShoppingBag, TrendingDown, TrendingUp, UserPlus, Wallet, X } from "lucide-react";
import type { Slice } from "@/lib/crmCharts";
import {
  GRANULARITY_LABELS,
  MAX_COMPARE,
  RANGE_DAILY_MAX_DAYS,
  yearsInRange,
  shiftAnchor,
  type CrmChartsResult,
  type Granularity,
} from "@/lib/crmPeriods";
import { COMPARE_COLORS, Card, CompareBars, Donut, Empty, HBars, Kpi, MUTED, PALETTE, Tip, money, num } from "./chartParts";

type Metric = "buyers" | "newCustomers" | "orders" | "spent";
const METRICS: { key: Metric; label: string }[] = [
  { key: "buyers", label: "Customers who bought" },
  { key: "newCustomers", label: "New customers" },
  { key: "orders", label: "Orders" },
  { key: "spent", label: "Spent" },
];

const genderName = (s: Slice): Slice => ({ ...s, name: s.name === "F" ? "Female" : s.name === "M" ? "Male" : s.name });
const colorOf = (i: number) => COMPARE_COLORS[i % COMPARE_COLORS.length];

// Names from every period, biggest first; "Other" and "Unknown" always last.
function mergeSlices(lists: Slice[][], top = 10): { name: string; values: number[] }[] {
  const names = [...new Set(lists.flat().map((s) => s.name))];
  const rows = names.map((name) => ({
    name,
    values: lists.map((l) => l.find((s) => s.name === name)?.value ?? 0),
  }));
  const tail = (n: string) => (n === "Unknown" ? 2 : n === "Other" ? 1 : 0);
  const total = (r: { values: number[] }) => r.values.reduce((a, b) => a + b, 0);
  return rows
    .sort((x, y) => tail(x.name) - tail(y.name) || total(y) - total(x) || x.name.localeCompare(y.name))
    .slice(0, top + 2);
}

// Day / week / month / year pickers. A week is any day in it (the server snaps
// it to its Monday); a year is picked from the list.
function PeriodPicker({
  gran,
  value,
  years,
  onChange,
}: {
  gran: Granularity;
  value: string;
  years: number[];
  onChange: (v: string) => void;
}) {
  const field = "rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground";
  // A range is "FROM..TO": two dates, each its own box.
  const [rangeFrom = "", rangeTo = ""] = value.split("..");
  const arrow =
    "inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground";
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Previous" onClick={() => onChange(shiftAnchor(gran, value, -1))} className={arrow}>
        <ChevronLeft className="size-4" />
      </button>
      {gran === "range" ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="From"
            value={rangeFrom}
            onChange={(e) => e.target.value && onChange(`${e.target.value}..${rangeTo || e.target.value}`)}
            className={field}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            aria-label="To"
            value={rangeTo}
            onChange={(e) => e.target.value && onChange(`${rangeFrom || e.target.value}..${e.target.value}`)}
            className={field}
          />
        </div>
      ) : gran === "year" ? (
        <select aria-label="Year" value={value} onChange={(e) => onChange(e.target.value)} className={field}>
          {(years.includes(Number(value)) ? years : [Number(value), ...years]).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={gran === "month" ? "month" : "date"}
          aria-label={GRANULARITY_LABELS[gran]}
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className={field}
        />
      )}
      <button type="button" aria-label="Next" onClick={() => onChange(shiftAnchor(gran, value, 1))} className={arrow}>
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

// "-9% vs August 2026 (338)" under a card, green when it grew and red when it fell.
function DeltaLine({ a, b, label, fmt, color }: { a: number; b: number; label: string; fmt: (n: number) => string; color: string }) {
  const pct = b === 0 ? null : ((a - b) / b) * 100;
  const up = a >= b;
  return (
    <span className="flex items-center gap-1">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className={pct === null ? "" : up ? "text-emerald-600" : "text-rose-600"}>
        {pct !== null && (up ? <TrendingUp className="mr-0.5 inline size-3.5" /> : <TrendingDown className="mr-0.5 inline size-3.5" />)}
        {pct !== null ? `${Math.abs(pct).toFixed(0)}% ` : ""}
      </span>
      <span className="text-muted-foreground">
        vs {label} ({fmt(b)})
      </span>
    </span>
  );
}

// "Compare a range:  [Start] - [End]  [Compare]" for years, like the Dashboard:
// every year from Start to End is put next to the main one in a single step. The
// years now being compared show as chips that can be dropped one by one.
function YearRange({
  main,
  compared,
  labels,
  onApply,
}: {
  main: string;
  compared: string[];
  labels: string[];
  onApply: (years: string[]) => void;
}) {
  const everyYear = [main, ...compared].map(Number);
  const [start, setStart] = useState(compared.length ? String(Math.min(...everyYear)) : "");
  const [end, setEnd] = useState(compared.length ? String(Math.max(...everyYear)) : "");
  const years = yearsInRange(Number(start), Number(end), main);
  const box =
    "w-20 rounded-full border border-border bg-transparent px-2.5 py-1 text-xs text-foreground outline-none focus:border-brand";
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
      <span className="text-xs font-medium text-muted-foreground">Compare a range:</span>
      <input
        type="number"
        inputMode="numeric"
        placeholder="Start"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className={box}
      />
      <span className="text-xs text-muted-foreground">–</span>
      <input
        type="number"
        inputMode="numeric"
        placeholder="End"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className={box}
      />
      <button
        type="button"
        onClick={() => onApply(years)}
        disabled={years.length === 0}
        className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Compare
      </button>
      {compared.length > 0 && (
        <button
          type="button"
          onClick={() => onApply([])}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
      {compared.map((y, i) => (
        <span
          key={y}
          className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-1 pl-2.5 text-xs"
        >
          <span className="size-2 rounded-full" style={{ background: colorOf(i + 1) }} aria-hidden />
          {labels[i] ?? y}
          <button
            type="button"
            aria-label={`Remove ${labels[i] ?? y}`}
            onClick={() => onApply(compared.filter((_, k) => k !== i))}
            className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

export default function CrmChartsClient({ data }: { data: CrmChartsResult }) {
  const router = useRouter();
  const { gran, periods, anchors } = data;
  const [a, ...others] = periods;
  const comparing = others.length > 0;
  const labels = periods.map((p) => p.label);
  const [metric, setMetric] = useState<Metric>("buyers");
  // "New customers" has no hour, so it can't be drawn for a single day.
  const activeMetric: Metric = gran === "day" && metric === "newCustomers" ? "buyers" : metric;

  // The pickers live in the page address, so a view can be reloaded or shared.
  function go(patch: Record<string, string | null>) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "crm-charts");
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`/marketing?${params.toString()}`, { scroll: false });
  }
  const compareAnchors = anchors.slice(1);
  const setCompare = (list: string[]) => go({ b: list.length ? list.join(",") : null });

  // The next period to add: one step before the last one shown, skipping any already there.
  function nextToAdd(): string {
    let next = shiftAnchor(gran, compareAnchors[compareAnchors.length - 1] ?? anchors[0], -1);
    while (anchors.includes(next)) next = shiftAnchor(gran, next, -1);
    return next;
  }

  const bucketCount = Math.max(...periods.map((p) => p.buckets.length));
  const trend = Array.from({ length: bucketCount }, (_, i) => ({
    label: periods.map((p) => p.buckets[i]?.label).find(Boolean) ?? "",
    ...Object.fromEntries(periods.map((p, k) => [`v${k}`, p.buckets[i]?.[activeMetric] ?? null])),
  }));
  const fmtMetric = activeMetric === "spent" ? money : num;
  const scopeNote = gran === "all" ? "All customers" : "Customers who bought in the period";
  const metricLabel = METRICS.find((m) => m.key === activeMetric)!.label;

  // The two customer cards open the CRM list showing exactly those customers: the
  // same period (and province), as its "Bought on" / "Customer since" filter.
  const state = data.province ? `&state=${encodeURIComponent(data.province)}` : "";
  const buyersHref = a.from
    ? `/marketing?bought_from=${a.from}&bought_to=${a.to}${state}`
    : `/marketing?sort=spent${state}`;
  const newHref = a.from
    ? `/marketing?since_from=${a.from}&since_to=${a.to}${state}`
    : `/marketing?${state.slice(1)}`;

  const kpis: {
    icon: typeof Receipt;
    label: string;
    key: Metric;
    tint: string;
    fmt: (n: number) => string;
    plain: string;
    href?: string;
  }[] = [
    { icon: ShoppingBag, label: "Customers who bought", key: "buyers", tint: "#3aa675", fmt: num, plain: `of ${num(data.totalCustomers)} customers`, href: buyersHref },
    { icon: UserPlus, label: "New customers", key: "newCustomers", tint: "#7c5cbf", fmt: num, plain: "joined in the period", href: newHref },
    { icon: Receipt, label: "Orders", key: "orders", tint: "#2b7fc4", fmt: num, plain: a.orders ? `${money(a.spent / a.orders)} per order` : "" },
    { icon: Wallet, label: "Spent", key: "spent", tint: "#e0a030", fmt: money, plain: "Item prices, before discounts" },
  ];

  return (
    <div className="min-h-screen space-y-6 p-6">
      <div>
        <h1 className="text-lg font-medium">CRM Charts</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Who your customers are and where they come from · {num(data.totalCustomers)} customers on file
        </p>
      </div>

      {/* Period bar: Day / Week / Month / Year, other periods to compare, and a province. */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex gap-1 rounded-xl border border-border bg-muted/50 p-1">
            {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={gran === g}
                onClick={() => go({ g, a: null, b: null })}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  gran === g ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {GRANULARITY_LABELS[g]}
              </button>
            ))}
          </div>

          {gran !== "all" && (
            <span className="size-2.5 rounded-full" style={{ background: colorOf(0) }} aria-hidden />
          )}
          {gran !== "all" && (
            <PeriodPicker gran={gran} value={anchors[0]} years={data.years} onChange={(v) => go({ a: v })} />
          )}

          {gran !== "all" && gran !== "year" && (
            <button
              type="button"
              aria-pressed={comparing}
              onClick={() => setCompare(comparing ? [] : [nextToAdd()])}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                comparing
                  ? "border-brand bg-brand text-white"
                  : "border-border text-foreground hover:bg-black/[.04] dark:hover:bg-white/[.06]"
              }`}
            >
              Compare
            </button>
          )}

          <select
            aria-label="Province"
            value={data.province}
            onChange={(e) => go({ province: e.target.value || null })}
            className="ml-auto rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="">All provinces</option>
            {data.provinces.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({num(p.value)})
              </option>
            ))}
          </select>
        </div>

        {/* Years: "Compare a range: Start - End" -- every year in between at once. */}
        {gran === "year" && (
          <YearRange
            key={compareAnchors.join(",")}
            main={anchors[0]}
            compared={compareAnchors}
            labels={periods.slice(1).map((p) => p.label)}
            onApply={setCompare}
          />
        )}

        {/* Days, weeks, months and ranges: "with" another one, picked from the calendar. */}
        {gran !== "year" && comparing && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">with</span>
            {compareAnchors.map((anchor, i) => (
              <div key={anchor} className="flex items-center gap-1.5 rounded-xl border border-border py-1 pr-1 pl-2.5">
                <span className="size-2.5 rounded-full" style={{ background: colorOf(i + 1) }} aria-hidden />
                <PeriodPicker
                  gran={gran}
                  value={anchor}
                  years={data.years}
                  onChange={(v) => setCompare(compareAnchors.map((x, k) => (k === i ? v : x)))}
                />
                <button
                  type="button"
                  aria-label="Remove this period"
                  onClick={() => setCompare(compareAnchors.filter((_, k) => k !== i))}
                  className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {compareAnchors.length < MAX_COMPARE && (
              <button
                type="button"
                onClick={() => setCompare([...compareAnchors, nextToAdd()])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Plus className="size-4" />
                Add period
              </button>
            )}
          </div>
        )}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {periods.map((p, i) => (
            <span key={p.label} className="inline-flex items-center gap-1.5 font-medium" style={{ color: colorOf(i) }}>
              <span className="size-2 rounded-full" style={{ background: colorOf(i) }} />
              {p.label}
            </span>
          ))}
          {data.province && <span>· {data.province}</span>}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Kpi
            key={k.key}
            icon={k.icon}
            label={k.label}
            value={k.fmt(a[k.key])}
            tint={k.tint}
            href={k.href}
            note={
              comparing ? (
                <span className="flex flex-col gap-0.5">
                  {others.slice(0, 4).map((p, i) => (
                    <DeltaLine key={p.label} a={a[k.key]} b={p[k.key]} label={p.label} fmt={k.fmt} color={colorOf(i + 1)} />
                  ))}
                  {others.length > 4 && (
                    <span className="text-muted-foreground">+ {others.length - 4} more periods (see the chart)</span>
                  )}
                </span>
              ) : (
                k.plain || undefined
              )
            }
          />
        ))}
      </div>

      <Card
        title={comparing ? `${metricLabel}: ${periods.length <= 4 ? labels.join(" vs ") : `${labels[0]} vs ${others.length} other periods`}` : metricLabel}
        subtitle={
          gran === "day"
            ? "By hour"
            : gran === "week"
              ? "By day of the week"
              : gran === "month"
                ? "By day"
                : gran === "range"
                  ? a.from && Math.round((Date.parse(a.to) - Date.parse(a.from)) / 864e5) + 1 <= RANGE_DAILY_MAX_DAYS
                    ? "By day"
                    : "By month"
                  : "By month"
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {METRICS.filter((m) => !(gran === "day" && m.key === "newCustomers")).map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={activeMetric === m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activeMetric === m.key
                  ? "border-brand bg-brand text-white"
                  : "border-border text-foreground hover:bg-black/[.04] dark:hover:bg-white/[.06]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <defs>
                <linearGradient id="crm-a" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorOf(0)} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={colorOf(0)} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (activeMetric === "spent" ? money(v) : num(v))}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--border)", strokeDasharray: "3 4" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as Record<string, number | string | null>;
                  return (
                    <div className="min-w-[11rem] rounded-xl border border-white/10 bg-[#161616] px-3.5 py-2.5 shadow-xl shadow-black/50">
                      <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">{String(row.label)}</p>
                      {periods.map((p, i) => (
                        <p key={p.label} className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-white">
                          <span className="size-2 rounded-full" style={{ background: colorOf(i) }} />
                          <span className="font-medium text-white/60">{p.label}</span>
                          <span className="ml-auto pl-3">
                            {row[`v${i}`] === null || row[`v${i}`] === undefined ? "—" : fmtMetric(Number(row[`v${i}`]))}
                          </span>
                        </p>
                      ))}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="v0"
                stroke={colorOf(0)}
                strokeWidth={2.5}
                fill="url(#crm-a)"
                connectNulls
                activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: colorOf(0) }}
              />
              {others.map((p, i) => (
                <Area
                  key={p.label}
                  type="monotone"
                  dataKey={`v${i + 1}`}
                  stroke={colorOf(i + 1)}
                  strokeWidth={2.25}
                  strokeDasharray="5 4"
                  fill="none"
                  connectNulls
                  activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2, fill: colorOf(i + 1) }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Gender" subtitle={scopeNote}>
          {comparing ? (
            <CompareBars rows={mergeSlices(periods.map((p) => p.byGender.map(genderName)))} labels={labels} />
          ) : (
            <Donut data={a.byGender.map(genderName)} />
          )}
        </Card>
        <Card title="Age range" subtitle={scopeNote}>
          {comparing ? (
            <CompareBars rows={mergeSlices(periods.map((p) => p.byAge))} labels={labels} />
          ) : a.byAge.length === 0 ? (
            <Empty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.byAge} margin={{ top: 22, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip />} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={56}>
                    {a.byAge.map((d, i) => (
                      <Cell key={d.name} fill={d.name === "Unknown" || d.name === "Other" ? MUTED : PALETTE[i % PALETTE.length]} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="top"
                      formatter={(v: unknown) => num(Number(v))}
                      style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Customers by province" subtitle={`${scopeNote} · top 8, the rest grouped as Other`}>
          {comparing ? <CompareBars rows={mergeSlices(periods.map((p) => p.byState), 9)} labels={labels} /> : <HBars data={a.byState} />}
        </Card>
        <Card title="Phnom Penh by district" subtitle={`${scopeNote} · top 10 districts`}>
          {comparing ? <CompareBars rows={mergeSlices(periods.map((p) => p.byDistrict))} labels={labels} /> : <HBars data={a.byDistrict} />}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Nationality" subtitle={scopeNote}>
          {comparing ? <CompareBars rows={mergeSlices(periods.map((p) => p.byNationality))} labels={labels} /> : <Donut data={a.byNationality} />}
        </Card>
        <Card title="Top buyers" subtitle={`${a.label} · most spent (item prices, cancelled orders left out)`}>
          <HBars data={a.topBuyers.map((t) => ({ name: t.name, value: t.spent }))} unit="$" format={money} />
        </Card>
      </div>
    </div>
  );
}
