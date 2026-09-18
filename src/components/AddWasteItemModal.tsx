"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { adjustStockAction } from "@/app/(app)/stock/actions";
import { setSimpleProductStockAction, setVariationStockAction } from "@/app/(app)/stock/websiteActions";
import type { StockPickerItem } from "@/lib/supabase/queries";

// Logs spoiled/damaged/expired stock in one step: pick a product (a plain POS
// product, or a size/flavor from the brand's live storefront catalog), type
// how many units were wasted, optionally note why.
//
// A plain POS item goes straight through adjustStockAction (category
// "waste"). A website item reuses setSimpleProductStockAction/
// setVariationStockAction -- the same two-way sync the Stock page's own
// price/stock edits use -- so the storefront's listed stock drops too, not
// just POS's internal count; that link is created on the fly if this is the
// item's first-ever edit here (see item.pos === null below).
export default function AddWasteItemModal({
  items,
  defaultDate,
  onClose,
}: {
  items: StockPickerItem[];
  // Whichever day/range Accountance is currently viewing -- seeds the Date
  // field the same way the Expense form seeds its own from fromDate, so
  // logging waste "for today" while looking at a past day doesn't silently
  // stamp it with the real current moment instead.
  defaultDate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StockPickerItem | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(defaultDate);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    searchRef.current?.focus();
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

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 20);
    return items.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [items, query]);

  function submit() {
    if (!selected) {
      setError("Choose a product first");
      return;
    }
    const amount = parseFloat(qty);
    if (Number.isNaN(amount) || amount <= 0) {
      setError("Enter how many units were wasted");
      return;
    }
    if (!date) {
      setError("Choose a date");
      return;
    }
    setError(null);
    const reason = note.trim() || "Waste";
    // Noon UTC keeps it safely inside the chosen calendar day regardless of
    // the viewer's own timezone -- same convention the date-range filters
    // elsewhere in Accountance use for day boundaries.
    const createdAt = `${date}T12:00:00.000Z`;
    startTransition(async () => {
      try {
        if (selected.website) {
          // Unlimited (null) starts tracking from 0, same as the Stock
          // page's own Add Stock box for one of these.
          const newSiteStock = (selected.website.siteStock ?? 0) - amount;
          const shared = {
            catalogId: selected.website.catalogId,
            siteProductId: selected.website.siteProductId,
            title: selected.name,
            imageUrl: selected.website.imageUrl,
            alreadyLinked: selected.pos !== null,
            seedPrice: selected.website.price,
            currentStock: selected.pos?.currentStock ?? 0,
            stock: newSiteStock,
            category: "waste" as const,
            reason,
            createdAt,
          };
          if (selected.website.variationId) {
            await setVariationStockAction({ ...shared, variationId: selected.website.variationId });
          } else {
            await setSimpleProductStockAction(shared);
          }
        } else if (selected.pos) {
          await adjustStockAction({
            productId: selected.pos.productId,
            delta: -amount,
            reason,
            category: "waste",
            createdAt,
          });
        }
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to log waste");
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
        aria-labelledby="add-waste-title"
        className={`flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-2xl transition-all duration-150 ${
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/[.08] px-5 py-4 dark:border-white/[.145]">
          <div>
            <h2 id="add-waste-title" className="text-base font-semibold text-foreground">
              Add waste item
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Removes stock and counts it toward Waste for this brand.
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Product</span>
            {selected ? (
              <div className="flex items-center justify-between rounded border border-black/[.15] px-3 py-2 text-sm dark:border-white/[.2]">
                <span>
                  {selected.name}{" "}
                  <span className="text-xs text-zinc-400">
                    ({selected.displayStock === null ? "unlimited" : `${selected.displayStock} ${selected.unit}`}
                    {selected.displayStock !== null ? " on hand" : ""})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded border border-black/[.15] px-2.5 py-1.5 focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50">
                  <Search className="size-3.5 shrink-0 text-zinc-400" />
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder="Search product..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full min-w-0 border-0 bg-transparent p-0 text-sm outline-none"
                  />
                </div>
                <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-black/[.1] dark:border-white/[.15]">
                  {matches.length === 0 && (
                    <li className="px-3 py-2 text-sm text-zinc-400">No products match.</li>
                  )}
                  {matches.map((p) => (
                    <li key={p.key}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(p);
                          setError(null);
                        }}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-zinc-400">
                          {p.displayStock === null ? "unlimited" : `${p.displayStock} ${p.unit}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {selected?.costPrice === null && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This product has no cost price recorded -- it will reduce stock but won&apos;t add to
                the Waste $ total until a cost price is set.
              </p>
            )}
          </label>

          <label className="mt-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40 rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm dark:border-white/[.2]"
            />
          </label>

          <label className="mt-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Quantity wasted</span>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="w-32 rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm dark:border-white/[.2]"
            />
          </label>

          <label className="mt-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">
              Note<span className="ml-1 font-normal text-zinc-400">— optional</span>
            </span>
            <input
              type="text"
              placeholder="e.g. Dropped, expired, spoiled"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm dark:border-white/[.2]"
            />
          </label>
        </div>

        {error && <p className="px-5 pb-2 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-black/[.08] px-5 py-4 dark:border-white/[.145]">
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
            disabled={isPending || !selected}
            onClick={submit}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Logging…" : "Log waste"}
          </button>
        </div>
      </div>
    </div>
  );
}
