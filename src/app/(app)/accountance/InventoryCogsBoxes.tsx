import type { ReactNode } from "react";
import { Calculator, PackageCheck, PackagePlus, Warehouse } from "lucide-react";
import { formatCount } from "@/lib/formatNumber";
import { STOCK_TRACKING_START } from "@/lib/stockTracking";
import type { StockUnits } from "@/lib/supabase/queries";

const cardClass = "rounded-lg border border-black/[.08] bg-card p-4 shadow-sm dark:border-white/[.145]";
const labelClass = "flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400";

function box(label: string, icon: ReactNode, value: string, note: string, negative = false) {
  return (
    <div className={cardClass}>
      <div className={labelClass}>
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${negative ? "text-rose-600 dark:text-rose-400" : ""}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{note}</div>
    </div>
  );
}

// Units of stock for the selected business and range: what was in stock at the start of the range (beginning), what
// was added in the range (purchased), the stock sold to customers in the range (ending), and the
// fourth box works out beginning + purchased - ending.
export default function InventoryCogsBoxes({ units }: { units: StockUnits | null }) {
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
  return (
    <>
      {box("Beginning Inventory", <Warehouse className="size-3.5" />, formatCount(units.beginning), "units in stock at start of period")}
      {box("Inventory Purchased", <PackagePlus className="size-3.5" />, formatCount(units.purchased), "units added")}
      {box("Ending Inventory", <PackageCheck className="size-3.5" />, formatCount(units.ending), "units sold to customers")}
      {box(
        "Cost of goods sold",
        <Calculator className="size-3.5" />,
        formatCount(cogs),
        "Beginning + Purchased − Ending",
        cogs < 0
      )}
    </>
  );
}
