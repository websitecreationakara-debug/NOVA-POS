"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Calculator, ChevronDown, PackageCheck, PackagePlus, Warehouse } from "lucide-react";
import { formatCount } from "@/lib/formatNumber";
import { ppDay } from "@/lib/phnomPenhTime";
import { STOCK_TRACKING_START } from "@/lib/stockTracking";
import type { StockUnits } from "@/lib/supabase/queries";
import UndoStockAddDialog from "@/components/UndoStockAddDialog";

const cardClass = "rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]";
const labelClass = "flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400";

function box(
  label: string,
  icon: ReactNode,
  value: string,
  note: string,
  negative = false,
  toggle?: { open: boolean; onClick: () => void }
) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={labelClass}>
          {icon}
          {label}
        </span>
        {toggle && (
          <ChevronDown
            className={`size-3.5 shrink-0 text-zinc-500 transition-transform ${toggle.open ? "rotate-180" : ""}`}
          />
        )}
      </div>
      <div className={`mt-1 text-xl font-semibold ${negative ? "text-rose-600 dark:text-rose-400" : ""}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{note}</div>
    </>
  );
  if (!toggle) return <div className={cardClass}>{content}</div>;
  return (
    <button
      type="button"
      onClick={toggle.onClick}
      aria-expanded={toggle.open}
      className={`${cardClass} text-left transition-colors hover:bg-black/[.02] dark:hover:bg-white/[.04]`}
    >
      {content}
    </button>
  );
}

// Units of stock for the selected business and range: what was in stock at the start of the range
// (beginning), what was added (purchased -- click it to see which products), the stock sold to
// customers in the range (ending), and the fourth box works out beginning + purchased - ending.
export default function InventoryCogsBoxes({ units }: { units: StockUnits | null }) {
  const [purchasedOpen, setPurchasedOpen] = useState(false);
  // The product whose Undo was clicked, waiting for confirmation in the dialog.
  const [confirmUndo, setConfirmUndo] = useState<{ productId: string; name: string; quantity: number } | null>(null);

  if (!units) {
    const note = `stock tracking starts ${STOCK_TRACKING_START}`;
    return (
      <>
        {box("Beginning Inventory", <Warehouse className="size-3.5" />, "—", note)}
        {box("Inventory Purchased", <PackagePlus className="size-3.5" />, "—", note)}
        {box("Ending Inventory", <PackageCheck className="size-3.5" />, "—", note)}
        {box("Cost of goods sold", <Calculator className="size-3.5" />, "—", note)}
      </>
    );
  }
  const cogs = Math.round((units.beginning + units.purchased - units.ending) * 100) / 100;
  const productCount = units.purchasedItems.length;
  return (
    <>
      {box("Beginning Inventory", <Warehouse className="size-3.5" />, formatCount(units.beginning), "units in stock at start of period")}
      {box(
        "Inventory Purchased",
        <PackagePlus className="size-3.5" />,
        formatCount(units.purchased),
        `units added · ${productCount} product${productCount === 1 ? "" : "s"}`,
        false,
        { open: purchasedOpen, onClick: () => setPurchasedOpen((v) => !v) }
      )}
      {box("Ending Inventory", <PackageCheck className="size-3.5" />, formatCount(units.ending), "units sold to customers")}
      {box(
        "Cost of goods sold",
        <Calculator className="size-3.5" />,
        formatCount(cogs),
        "Beginning + Purchased − Ending",
        cogs < 0
      )}

      {purchasedOpen && (
        <section className="col-span-full rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Products with stock updated</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Stock added by hand in this period, net of anything taken back out.
              </p>
            </div>
            <Link
              href="/stock"
              className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:brightness-95"
            >
              Update stock
            </Link>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 pr-3 text-right font-medium">Units added</th>
                  <th className="py-2 pr-3 text-right font-medium">Last updated</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
                {units.purchasedItems.map((i) => (
                  <tr key={i.productId}>
                    <td className="py-2 pr-3">{i.name}</td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${i.quantity < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
                    >
                      {i.quantity > 0 ? "+" : ""}
                      {formatCount(i.quantity)}
                    </td>
                    <td className="py-2 pr-3 text-right text-zinc-500">
                      {ppDay(i.lastAt)}{" "}
                      {new Date(i.lastAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 text-right">
                      {i.quantity > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmUndo({ productId: i.productId, name: i.name, quantity: i.quantity })}
                          title="Added to the wrong product? Take this stock back out."
                          className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.08]"
                        >
                          Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {units.purchasedItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-zinc-500">
                      No stock was added in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirmUndo && (
        <UndoStockAddDialog
          productId={confirmUndo.productId}
          productName={confirmUndo.name}
          quantity={confirmUndo.quantity}
          onClose={() => setConfirmUndo(null)}
        />
      )}
    </>
  );
}
