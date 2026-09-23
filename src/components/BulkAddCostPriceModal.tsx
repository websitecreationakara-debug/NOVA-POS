"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { setProductCostAction, setProductPriceAction } from "@/app/(app)/stock/actions";
import type { MarginReportRow } from "@/lib/supabase/queries";

// One screen listing only the products missing a cost price, each a single
// row of two inputs -- lets someone tab straight down the Unit Cost column
// and fill every row in one sitting instead of opening 12 rows one at a time
// in the table. Selling Price is prefilled from the product's current price
// (Enter, not required to be edited) so it's there to tweak without an extra
// trip back to the table.
export default function BulkAddCostPriceModal({
  rows,
  onClose,
}: {
  rows: MarginReportRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.productId, String(r.sellingPrice)]))
  );
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    firstInputRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filledCount = useMemo(
    () => rows.filter((r) => (costDrafts[r.productId] ?? "").trim() !== "").length,
    [rows, costDrafts]
  );

  function saveAll() {
    // Only products with a non-empty, valid Unit Cost get saved -- leaving a
    // row blank just skips it rather than blocking the rest of the batch.
    const toSave = rows
      .map((r) => {
        const rawCost = (costDrafts[r.productId] ?? "").trim();
        if (rawCost === "") return null;
        const costPrice = parseFloat(rawCost);
        if (Number.isNaN(costPrice) || costPrice < 0) return null;
        const rawPrice = priceDrafts[r.productId];
        const price = rawPrice === undefined ? r.sellingPrice : parseFloat(rawPrice);
        return {
          productId: r.productId,
          costPrice,
          price: Number.isNaN(price) || price < 0 ? r.sellingPrice : price,
          priceChanged: price !== r.sellingPrice,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    if (toSave.length === 0) {
      setError("Enter at least one unit cost first");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        await Promise.all(
          toSave.flatMap((r) => [
            setProductCostAction({ productId: r.productId, costPrice: r.costPrice }),
            ...(r.priceChanged ? [setProductPriceAction({ productId: r.productId, price: r.price })] : []),
          ])
        );
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save costs");
      }
    });
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        if (!isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-cost-title"
        className={`flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl transition-all duration-150 ${
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/[.08] px-5 py-4 dark:border-white/[.145]">
          <div>
            <h2 id="bulk-cost-title" className="text-base font-semibold text-foreground">
              Add missing cost prices
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {rows.length} product{rows.length === 1 ? "" : "s"} need
              {rows.length === 1 ? "s" : ""} a unit cost. Tab through and save all at once.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded p-1 text-zinc-500 hover:bg-black/[.06] dark:hover:bg-white/[.1]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="grid grid-cols-[1fr_7rem_7rem] items-center gap-x-3 gap-y-2">
            <div className="text-xs font-medium text-zinc-500">Product</div>
            <div className="text-xs font-medium text-zinc-500">Unit cost</div>
            <div className="text-xs font-medium text-zinc-500">Selling price</div>
            {rows.map((r, i) => (
              <Fragment key={r.productId}>
                <div className="truncate py-1 text-sm">
                  {r.name}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-400">$</span>
                  <input
                    ref={i === 0 ? firstInputRef : undefined}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={costDrafts[r.productId] ?? ""}
                    onChange={(e) => setCostDrafts((prev) => ({ ...prev, [r.productId]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveAll();
                    }}
                    className="w-full rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-400">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={priceDrafts[r.productId] ?? String(r.sellingPrice)}
                    onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [r.productId]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveAll();
                    }}
                    className="w-full rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                  />
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        {error && <p className="px-5 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 border-t border-black/[.08] px-5 py-4 dark:border-white/[.145]">
          <span className="text-xs text-zinc-500">
            {filledCount} of {rows.length} filled in
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending || filledCount === 0}
              onClick={saveAll}
              className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {isPending ? "Saving…" : `Save ${filledCount || ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
