"use client";

// Chart building blocks shared by the Marketing > CRM Charts and Product Insight
// pages: palette, number formats, tooltip, card, KPI tile, ring chart and bars.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Slice } from "@/lib/crmCharts";

// One colour per slice / bar, in order -- the same family the Dashboard charts use.
export const PALETTE = ["#2b7fc4", "#0891b2", "#7c5cbf", "#c2478d", "#e0a030", "#3aa675", "#e0674b", "#8a94a6"];
export const MUTED = "#8a94a6";

export const num = (n: number) => n.toLocaleString("en-US");
export const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

// A floating tooltip: its own dark surface in both themes, like the Dashboard's.
export function Tip({
  active,
  payload,
  label,
  unit = "customers",
}: {
  active?: boolean;
  payload?: readonly { value?: unknown; name?: unknown; payload?: Record<string, unknown> }[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const title = String(label ?? p.payload?.name ?? p.name ?? "");
  return (
    <div className="min-w-[8rem] rounded-xl border border-white/10 bg-[#161616] px-3.5 py-2.5 shadow-xl shadow-black/50">
      <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">{title}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">
        {unit === "$" ? money(Number(p.value)) : `${num(Number(p.value))} ${unit}`}
      </p>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-5 shadow-sm ${className}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Kpi({
  icon: Icon,
  label,
  value,
  note,
  noteTone = "muted",
  tint,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: React.ReactNode;
  noteTone?: "muted" | "up" | "down";
  tint: string;
  // Makes the whole card a link (e.g. to the customers the number counts).
  href?: string;
}) {
  const tone =
    noteTone === "up" ? "text-emerald-600" : noteTone === "down" ? "text-rose-600" : "text-muted-foreground";
  const card = (
    <div
      className={`relative h-full rounded-2xl border border-border bg-card p-5 shadow-sm ${
        href ? "group transition-colors hover:border-brand/60 hover:bg-muted/40" : ""
      }`}
    >
      {href && (
        <span className="absolute right-4 bottom-4 inline-flex items-center gap-0.5 text-xs font-medium text-brand opacity-70 transition-opacity group-hover:opacity-100">
          View customers
          <ArrowUpRight className="size-3.5" />
        </span>
      )}
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl" style={{ background: `${tint}1f`, color: tint }}>
          <Icon className="size-5" />
        </span>
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {note && <div className={`mt-1 flex items-center gap-1 text-xs ${tone}`}>{note}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      {card}
    </Link>
  ) : (
    card
  );
}

// Ring chart with the total in the middle and a legend (count + share) beside it.
export function Donut({
  data,
  unit = "customers",
  format = num,
}: {
  data: Slice[];
  unit?: string;
  format?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <Empty />;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="64%"
              outerRadius="100%"
              paddingAngle={data.length > 1 ? 2 : 0}
              cornerRadius={6}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={d.name === "Unknown" || d.name === "Other" ? MUTED : PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<Tip unit={unit} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{format(total)}</span>
          <span className="text-[11px] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: d.name === "Unknown" || d.name === "Other" ? MUTED : PALETTE[i % PALETTE.length] }}
            />
            <span className="truncate">{d.name}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {format(d.value)} <span className="text-xs">· {((d.value / total) * 100).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Horizontal bars, one row per slice, value at the end of each bar.
export function HBars({
  data,
  unit = "customers",
  format = num,
}: {
  data: { name: string; value: number }[];
  unit?: string;
  format?: (n: number) => string;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) return <Empty />;
  const height = Math.max(180, data.length * 38);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap="22%">
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={118}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<Tip unit={unit} />} />
          <Bar dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={22}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={d.name === "Unknown" || d.name === "Other" ? MUTED : PALETTE[i % PALETTE.length]} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: unknown) => format(Number(v))}
              style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Empty() {
  return <p className="py-10 text-center text-sm text-muted-foreground">No data yet.</p>;
}


// Several periods side by side, one colour each (the first is the main period).
export const COMPARE_COLORS = [
  "#2b7fc4",
  "#7c5cbf",
  "#0891b2",
  "#c2478d",
  "#e0a030",
  "#3aa675",
  "#e0674b",
  "#5b6ee1",
  "#14b8a6",
  "#a3a31a",
  "#b45309",
  "#64748b",
];

// One group of bars per name, one bar per period, in the periods' colours.
export function CompareBars({
  rows,
  labels,
  unit = "customers",
}: {
  rows: { name: string; values: number[] }[];
  labels: string[];
  unit?: string;
}) {
  if (rows.length === 0 || rows.every((r) => r.values.every((v) => v === 0))) return <Empty />;
  const data = rows.map((r) => ({
    name: r.name,
    ...Object.fromEntries(r.values.map((v, i) => [`v${i}`, v])),
  }));
  // Thinner bars once there are many periods, so a group does not grow too tall.
  const slim = labels.length > 3;
  const height = Math.max(200, rows.length * (slim ? labels.length * 10 + 22 : labels.length * 15 + 26));
  // With many periods the numbers at the end of the bars would crowd each other.
  const showNumbers = labels.length <= 3;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {labels.map((l, i) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
            {l}
          </span>
        ))}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap="20%" barGap={2}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={118}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number | string>;
                return (
                  <div className="min-w-[10rem] rounded-xl border border-white/10 bg-[#161616] px-3.5 py-2.5 shadow-xl shadow-black/50">
                    <p className="text-[11px] font-medium tracking-wide text-white/45 uppercase">{String(row.name)}</p>
                    {labels.map((l, i) => (
                      <p key={l} className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-white">
                        <span className="size-2 rounded-full" style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }} />
                        <span className="font-medium text-white/60">{l}</span>
                        <span className="ml-auto pl-3">{num(Number(row[`v${i}`]))}</span>
                      </p>
                    ))}
                    <p className="mt-1 text-[11px] text-white/45">{unit}</p>
                  </div>
                );
              }}
            />
            {labels.map((l, i) => (
              <Bar key={l} dataKey={`v${i}`} radius={[0, 6, 6, 0]} maxBarSize={slim ? 8 : 12} fill={COMPARE_COLORS[i % COMPARE_COLORS.length]}>
                {showNumbers && (
                  <LabelList
                    dataKey={`v${i}`}
                    position="right"
                    formatter={(v: unknown) => num(Number(v))}
                    style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
