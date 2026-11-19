"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import {
  PLAN_ITEMS_PER_DAY,
  formatBroadcast,
  formatOptions,
  formatPlan,
  planMonth,
  weekdayOf,
  type BroadcastItem,
  type BroadcastSection,
} from "@/lib/broadcast";

// A spreadsheet cell: thin grid lines on every side.
const cell = "border border-border px-2 py-1";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Marketing > Broadcast > Month plan: every date of the month with the products to broadcast that day.
export default function BroadcastPlan({
  businessName,
  sections,
  today,
}: {
  businessName: string;
  sections: BroadcastSection[];
  today: string;
}) {
  const [ym, setYm] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const [copied, setCopied] = useState<string | null>(null);
  const days = useMemo(() => planMonth(sections, ym.year, ym.month), [sections, ym]);

  // One spreadsheet row per product. Date and Group show on a day's first row; Business and Category only
  // where they change from the row above, like the parent labels in the category sheet.
  const rows = useMemo(() => {
    const out: {
      id: string;
      date: string;
      first: boolean;
      group: string;
      item: BroadcastItem | null;
      keys: string[];
      business: string;
      category: string;
    }[] = [];
    let prevBus = "";
    let prevCat = "";
    for (const d of days) {
      const [bus, cat] = d.group ? d.path : ["", ""];
      const keys = d.items.map((i) => i.key);
      const items: (BroadcastItem | null)[] = d.items.length > 0 ? d.items : [null];
      items.forEach((item, idx) => {
        const changed = bus !== prevBus || cat !== prevCat;
        out.push({
          id: `${d.date}-${item?.key ?? "none"}`,
          date: d.date,
          first: idx === 0,
          // Blank when the group is the category itself (Cooked Seafoods), like the sheet.
          group: d.group && d.group !== cat ? d.group : "",
          item,
          keys,
          business: changed ? bus : "",
          category: changed ? cat : "",
        });
        prevBus = bus;
        prevCat = cat;
      });
    }
    return out;
  }, [days]);

  function step(delta: number) {
    const d = new Date(Date.UTC(ym.year, ym.month - 1 + delta, 1));
    setYm({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      // Clipboard blocked: nothing to do.
    }
  }

  const copyBtn = "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-black/[.04] dark:hover:bg-white/[.06]";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="rounded-full border border-border p-1.5 hover:bg-black/[.04] dark:hover:bg-white/[.06]">
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-36 text-center text-sm font-medium">
          {MONTHS[ym.month - 1]} {ym.year}
        </span>
        <button type="button" aria-label="Next month" onClick={() => step(1)} className="rounded-full border border-border p-1.5 hover:bg-black/[.04] dark:hover:bg-white/[.06]">
          <ChevronRight className="size-4" />
        </button>
        <button type="button" onClick={() => copy("all", formatPlan(days))} className={`${copyBtn} ml-auto`}>
          {copied === "all" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied === "all" ? "Copied" : "Copy whole month"}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        One group a day, {PLAN_ITEMS_PER_DAY} products each, rotating through what is in stock now. Grade = priority across all products (1 = broadcast first): most orders in the last 90 days, then most stock.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs font-medium text-muted-foreground">
              {["Date", "Business", "Category", "Group", "Product", "Packs & price"].map((h) => (
                <th key={h} className={`${cell} font-medium`}>
                  {h}
                </th>
              ))}
              <th
                className={`${cell} w-16 text-right font-medium`}
                title="Priority across all products: 1 = broadcast first (recent orders, then stock)"
              >
                Grade
              </th>
              <th className={`${cell} w-36`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dim = r.date < today ? "opacity-50" : "";
              const top = r.first ? "border-t-2" : "";
              const weekend = weekdayOf(r.date) === "Sat" || weekdayOf(r.date) === "Sun";
              return (
                <tr key={r.id} className={`${dim} ${r.date === today ? "bg-brand/10" : ""}`}>
                  <td className={`${cell} ${top} whitespace-nowrap align-top`}>
                    {r.first && (
                      <>
                        <span className="font-medium">{Number(r.date.slice(8))}</span>{" "}
                        <span className={weekend ? "text-brand" : "text-muted-foreground"}>{weekdayOf(r.date)}</span>
                        {r.date === today && (
                          <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-medium text-white">today</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={`${cell} ${top} align-top`}>{r.business}</td>
                  <td className={`${cell} ${top} align-top`}>{r.category}</td>
                  <td className={`${cell} ${top} align-top font-medium`}>{r.first ? r.group : ""}</td>
                  {r.item ? (
                    <>
                      <td className={`${cell} ${top}`}>{r.item.name}</td>
                      <td className={`${cell} ${top} text-muted-foreground`}>{formatOptions(r.item.options)}</td>
                      <td className={`${cell} ${top} text-right tabular-nums`}>{r.item.grade}</td>
                    </>
                  ) : (
                    <td colSpan={3} className={`${cell} ${top} text-muted-foreground`}>
                      Nothing in stock to broadcast.
                    </td>
                  )}
                  <td className={`${cell} ${top} align-top`}>
                    {r.first && r.item && (
                      <button
                        type="button"
                        onClick={() => copy(r.date, formatBroadcast(businessName, sections, new Set(r.keys)))}
                        className={`${copyBtn} w-full justify-center`}
                      >
                        {copied === r.date ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied === r.date ? "Copied" : "Copy message"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
