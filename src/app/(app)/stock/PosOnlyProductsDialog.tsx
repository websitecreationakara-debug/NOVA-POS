"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Store, Trash2, TriangleAlert, X } from "lucide-react";
import {
  adjustStockAction,
  createPosOnlyProductAction,
  deactivateProductAction,
  listOtherBrandImageChoicesAction,
  removeProductImageAction,
  renameProductAction,
  setPosOnlyCostAction,
  setPosOnlyDetailsAction,
  setPosOnlyImageUrlAction,
  setPosOnlyStockSourceAction,
  unlinkPosOnlyStockAction,
  setProductPriceAction,
  uploadProductImageAction,
} from "./actions";
import type { ProductWithStock } from "@/lib/supabase/queries";
import {
  derivePurchaseCost,
  EMPTY_PURCHASE_COSTS,
  purchaseCostKey,
  type PurchaseCostFields,
} from "@/lib/websiteProducts/purchaseCosts";
import { formatUsd } from "@/lib/formatNumber";
import { ENGLISH_SCALES, KHMER_SCALES } from "@/lib/khmerScales";
import type { WebsiteCatalogId } from "@/lib/websiteProducts/types";

// A picture another product of the business already has: its name, the picture address and
// that product's stock (null = not tracked).
// url is null for a product with no picture: it is still offered (so searching its name finds it),
// and picking it only brings its name across.
export type ImageChoice = {
  name: string;
  nameKm: string | null;
  url: string | null;
  stock: number | null;
  // The business it belongs to -- only set for another business's product.
  brand?: string;
};

// A website product (or one size of it) a POS-only product can take its stock from.
export type StockChoice = {
  name: string;
  nameKm: string | null;
  url: string | null;
  stock: number | null;
  source: { siteProductId: string; variationId: string | null };
  // One size of a product with sizes -- kept out of the stock list, which shows the product once.
  size?: boolean;
};

const cellInput =
  "rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm tabular-nums focus:border-black/40 focus:outline-none dark:border-white/[.2] dark:focus:border-white/50";
const moneyCell =
  "inline-flex items-center gap-1 rounded border border-black/[.15] px-2 py-1 text-sm tabular-nums focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50";

// One "$ ____" cost cell. Saves when you click away or press Enter; `placeholder` shows
// the worked-out figure (greyed) when nothing is typed.
function CostInput({
  id,
  value,
  placeholder,
  wide,
  title,
  disabled,
  onSave,
}: {
  id: string;
  value: number | null;
  placeholder?: number | null;
  wide?: boolean;
  title?: string;
  disabled?: boolean;
  onSave: (value: string) => void;
}) {
  return (
    <label className={`${moneyCell} ${wide ? "w-[5.5rem] font-medium" : "w-16"}`} title={title}>
      <span className="select-none text-zinc-400">$</span>
      <input
        key={`${id}-${value}`}
        type="number"
        min={0}
        step="0.01"
        placeholder={placeholder != null && value === null ? placeholder.toFixed(2) : "—"}
        defaultValue={value ?? ""}
        disabled={disabled}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-full min-w-0 bg-transparent text-right outline-none"
      />
    </label>
  );
}

// The POS-only products already added, laid out like the Stock page's website table
// (Image, Product, cost, Price, Stock, Add Stock, Status, Actions) with every cell
// editable in place -- inside the dialog, and as the Stock page's "POS only" tab.
// Cost is the product's own cost price (it has no website purchase-cost breakdown).
export function PosOnlyProductsTable({
  brandId,
  products,
  purchaseCosts,
  imageChoices = [],
  stockChoices = [],
  catalogId,
}: {
  brandId: string;
  products: ProductWithStock[];
  purchaseCosts?: Record<string, PurchaseCostFields>;
  imageChoices?: ImageChoice[];
  stockChoices?: StockChoice[];
  catalogId?: WebsiteCatalogId;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // The product the "+ POS-only product" button just added: its name box takes the cursor.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  // The picture shown large in a pop-up (click a picture in the Image column).
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  // The product whose Edit box (pencil) is open, and what is typed in it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", nameKm: "", unit: "pcs", unitKm: "", weightGrams: "" });
  // "Choose from products" (pictures the business's other products already have).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  // The stock list (click the small Stock box next to the picture): every product's stock.
  const [stockOpen, setStockOpen] = useState(false);
  const [stockSearch, setStockSearch] = useState("");

  function run(task: () => Promise<unknown>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await task();
        after?.();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function openEdit(p: ProductWithStock) {
    setPickerOpen(false);
    setPickerSearch("");
    setStockOpen(false);
    setStockSearch("");
    if (editingId === p.id) return setEditingId(null);
    setDraft({
      name: p.name,
      nameKm: p.name_km ?? "",
      unit: p.unit,
      unitKm: p.unit_km ?? "",
      weightGrams: p.weight_grams != null ? String(p.weight_grams) : "",
    });
    setEditingId(p.id);
  }

  function saveEdit(p: ProductWithStock) {
    const raw = draft.weightGrams.trim();
    const weightGrams = raw === "" ? null : Number(raw);
    if (weightGrams !== null && (Number.isNaN(weightGrams) || weightGrams <= 0)) {
      return setError("Weight must be greater than zero");
    }
    run(
      () =>
        setPosOnlyDetailsAction({
          productId: p.id,
          name: draft.name,
          nameKm: draft.nameKm,
          unit: draft.unit,
          unitKm: draft.unitKm,
          weightGrams,
        }),
      () => setEditingId(null)
    );
  }

  const num = (value: string) => (value.trim() === "" ? NaN : parseFloat(value));

  function saveName(p: ProductWithStock, value: string) {
    const name = value.trim();
    if (name && name !== p.name) run(() => renameProductAction({ productId: p.id, name }));
  }

  // A POS-only product's cost columns are kept under "pos:<id>" (see setPosOnlyCostAction).
  const costs = (p: ProductWithStock) =>
    purchaseCosts?.[purchaseCostKey(`pos:${p.id}`, "")] ?? EMPTY_PURCHASE_COSTS;

  function saveCost(
    p: ProductWithStock,
    field: "original_cost" | "total_cost_10pct" | "extra_money" | "total_override",
    value: string,
    current: number | null
  ) {
    const raw = value.trim();
    const next = raw === "" ? null : parseFloat(raw);
    if (next !== null && (Number.isNaN(next) || next < 0)) return;
    if (next === current) return;
    run(() => setPosOnlyCostAction({ productId: p.id, fields: { [field]: next } }));
  }

  function savePrice(p: ProductWithStock, value: string) {
    const next = num(value);
    if (Number.isNaN(next) || next < 0 || next === Number(p.price)) return;
    run(() => setProductPriceAction({ productId: p.id, price: next }));
  }

  function saveStock(p: ProductWithStock, value: string) {
    const next = num(value);
    if (Number.isNaN(next) || next < 0 || (next === p.stock_quantity && !p.stock_untracked)) return;
    // typing a number counts the product again
    run(async () => {
      if (p.stock_untracked) await unlinkPosOnlyStockAction({ productId: p.id });
      await adjustStockAction({ productId: p.id, delta: next - p.stock_quantity, reason: "Stock count" });
    });
  }

  // "Add Stock": a delivery received, added on top of what's there.
  function addStock(p: ProductWithStock, input: HTMLInputElement) {
    const amount = num(input.value);
    input.value = "";
    if (Number.isNaN(amount) || amount === 0) return;
    run(async () => {
      if (p.stock_untracked) await unlinkPosOnlyStockAction({ productId: p.id });
      await adjustStockAction({ productId: p.id, delta: amount, reason: "Stock added" });
    });
  }

  // "+ POS-only product": a new row appears at the top straight away, with everything blank
  // (price 0, stock 0) to be set in the row afterwards. Sales doesn't offer it until it has a name.
  function addBlankRow() {
    setError(null);
    startTransition(async () => {
      try {
        const { id } = await createPosOnlyProductAction({ brandId, name: "", price: 0, unit: "pcs", stock: 0 });
        setJustAddedId(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function pickImage(p: ProductWithStock, file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.set("productId", p.id);
    form.set("file", file);
    run(() => uploadProductImageAction(form));
  }

  // The other businesses' products, fetched the first time the picker opens, so a search finds a
  // product of any business -- not just this one.
  const [otherChoices, setOtherChoices] = useState<ImageChoice[] | null>(null);
  useEffect(() => {
    if (!pickerOpen || otherChoices !== null) return;
    let cancelled = false;
    listOtherBrandImageChoicesAction(brandId)
      .then((rows) => !cancelled && setOtherChoices(rows))
      .catch(() => !cancelled && setOtherChoices([]));
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, otherChoices, brandId]);
  const allChoices = [...imageChoices, ...(otherChoices ?? [])];
  const choices = allChoices.filter((c) => c.name.toLowerCase().includes(pickerSearch.trim().toLowerCase()));

  const addButton = (
    <button
      type="button"
      onClick={addBlankRow}
      disabled={isPending}
      title="Add a product that is sold at the POS only, not on the website"
      className="mb-3 flex shrink-0 items-center gap-1.5 rounded border border-black/[.15] px-3 py-1.5 text-sm font-medium disabled:opacity-60 dark:border-white/[.2]"
    >
      <Store className="size-3.5" />
      + POS-only product
      {products.length > 0 && (
        <span className="rounded-full bg-sky-500/15 px-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
          {products.length}
        </span>
      )}
    </button>
  );

  if (products.length === 0) {
    return (
      <>
        {addButton}
        {error && <p className="px-1 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No POS-only products yet.
        </p>
      </>
    );
  }

  return (
    <>
      {addButton}
      {error && <p className="px-1 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
              <th className="w-14 px-3 py-2 font-medium">Image</th>
              <th className="w-[14rem] max-w-[14rem] min-w-[12rem] px-3 py-2 font-medium">Product</th>
              <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">Original Cost</th>
              <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">Total Cost 10%</th>
              <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">Purchase Cost</th>
              <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">Extra Cost</th>
              <th className="w-24 border-r border-black/[.08] bg-black/[.015] px-2 py-2 text-right font-medium dark:border-white/[.145] dark:bg-white/[.02]">
                Total
              </th>
              <th className="w-24 px-2 py-2 text-right font-medium">Price</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Stock</th>
              <th className="w-20 px-2 py-2 text-right font-medium">Add Stock</th>
              <th className="w-32 px-3 py-2 font-medium">Status</th>
              <th className="w-16 px-2 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <Fragment key={p.id}>
              <tr className="border-b border-black/[.06] align-top dark:border-white/[.08]">
                <td className="px-3 py-2">
                  {p.image_url ? (
                    <button
                      type="button"
                      onClick={() => setPreview({ url: p.image_url as string, title: p.name })}
                      aria-label={`View picture of ${p.name}`}
                      title="View the picture"
                      className="block h-10 w-10 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <label
                      title="Add a picture"
                      className="block h-10 w-10 cursor-pointer overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800"
                    >
                      <span className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                        No img
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={isPending}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          e.target.value = "";
                          pickImage(p, file);
                        }}
                      />
                    </label>
                  )}
                </td>
                <td className="w-[14rem] max-w-[14rem] min-w-[12rem] px-3 py-2">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <input
                      key={`name-${p.id}-${p.name}`}
                      type="text"
                      defaultValue={p.name}
                      title={p.name}
                      placeholder="Product name"
                      autoFocus={p.id === justAddedId}
                      disabled={isPending}
                      onBlur={(e) => {
                        if (p.id === justAddedId) setJustAddedId(null);
                        saveName(p, e.target.value);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className={`field-sizing-content max-w-full min-w-[8rem] rounded border bg-transparent px-1 py-0.5 font-medium hover:border-black/[.15] focus:border-black/40 focus:outline-none disabled:opacity-50 dark:hover:border-white/[.2] dark:focus:border-white/50 ${
                        p.name ? "border-transparent" : "border-black/[.15] dark:border-white/[.2]"
                      }`}
                    />
                    <span className="shrink-0 text-xs text-zinc-400">{p.unit}</span>
                  </div>
                </td>
                <td className="bg-black/[.015] px-2 py-2 text-right dark:bg-white/[.02]">
                  <CostInput
                    id={`orig-${p.id}`}
                    value={costs(p).originalCost}
                    disabled={isPending}
                    onSave={(v) => saveCost(p, "original_cost", v, costs(p).originalCost)}
                  />
                </td>
                <td className="bg-black/[.015] px-2 py-2 text-right dark:bg-white/[.02]">
                  <CostInput
                    id={`t10-${p.id}`}
                    value={costs(p).totalCost10pct}
                    disabled={isPending}
                    onSave={(v) => saveCost(p, "total_cost_10pct", v, costs(p).totalCost10pct)}
                  />
                </td>
                <td className="bg-black/[.015] px-2 py-2 text-right tabular-nums text-zinc-500 dark:bg-white/[.02]">
                  {derivePurchaseCost(costs(p)).purchaseCost === null
                    ? "—"
                    : formatUsd(derivePurchaseCost(costs(p)).purchaseCost as number)}
                </td>
                <td className="bg-black/[.015] px-2 py-2 text-right dark:bg-white/[.02]">
                  <CostInput
                    id={`extra-${p.id}`}
                    value={costs(p).extraMoney}
                    disabled={isPending}
                    onSave={(v) => saveCost(p, "extra_money", v, costs(p).extraMoney)}
                  />
                </td>
                <td className="border-r border-black/[.08] bg-black/[.015] px-2 py-2 text-right dark:border-white/[.145] dark:bg-white/[.02]">
                  <CostInput
                    id={`total-${p.id}`}
                    value={costs(p).totalOverride}
                    placeholder={derivePurchaseCost(costs(p)).total}
                    wide
                    title="Manual override -- wins over Purchase Cost + Extra Cost, and works even when Original Cost / Total Cost 10% aren't filled in"
                    disabled={isPending}
                    onSave={(v) => saveCost(p, "total_override", v, costs(p).totalOverride)}
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <label className={`${moneyCell} w-20`}>
                    <span className="select-none text-zinc-400">$</span>
                    <input
                      key={`price-${p.id}-${p.price}`}
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={Number(p.price)}
                      disabled={isPending}
                      onBlur={(e) => savePrice(p, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="w-full min-w-0 border-0 bg-transparent p-0 text-right tabular-nums outline-none"
                    />
                  </label>
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    key={`stock-${p.id}-${p.stock_quantity}-${p.stock_untracked}`}
                    type="number"
                    min={0}
                    placeholder="—"
                    title={p.stock_untracked ? "Not counted (follows a product with no stock number) -- type a number to count it" : undefined}
                    defaultValue={p.stock_untracked ? "" : p.stock_quantity}
                    disabled={isPending}
                    onBlur={(e) => saveStock(p, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className={`${cellInput} w-16`}
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <input
                    type="number"
                    placeholder="0"
                    title="Adds to the current stock on save -- e.g. a delivery of 2 on top of 5 becomes 7"
                    disabled={isPending}
                    onBlur={(e) => addStock(p, e.currentTarget)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className={`${cellInput} w-16`}
                  />
                </td>
                <td className="px-3 py-2">
                  <span
                    title="Sold at the POS only, not on the website"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-600 dark:text-sky-400"
                  >
                    <span className="size-1.5 rounded-full bg-sky-500" />
                    POS only
                  </span>
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      aria-label={`Edit ${p.name}`}
                      aria-expanded={editingId === p.id}
                      title="Edit name, Khmer name, scale and weight"
                      className="rounded p-1 text-zinc-400 hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemovingId(p.id)}
                      aria-label={`Remove ${p.name}`}
                      className="rounded p-1 text-zinc-400 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </span>
                </td>
              </tr>
              {editingId === p.id && (
                <tr className="border-b border-black/[.06] dark:border-white/[.08]">
                  <td colSpan={12} className="px-3 pt-1 pb-4">
                    <div className="space-y-4 rounded-xl border border-black/[.1] bg-black/[.02] p-4 dark:border-white/[.15] dark:bg-white/[.03]">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <label className="block text-xs text-zinc-500">
                          Name now
                          <input
                            type="text"
                            value={draft.name}
                            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                          />
                        </label>
                        <label className="block text-xs text-zinc-500">
                          Name in Khmer
                          <input
                            type="text"
                            lang="km"
                            placeholder="ឈ្មោះជាភាសាខ្មែរ"
                            value={draft.nameKm}
                            onChange={(e) => setDraft((d) => ({ ...d, nameKm: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                          />
                        </label>
                        <label className="block text-xs text-zinc-500">
                          Scale
                          <select
                            value={draft.unit}
                            onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-black/[.15] bg-card px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                          >
                            {[...new Set([...ENGLISH_SCALES, draft.unit])].map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-zinc-500">
                          Scale in Khmer
                          <select
                            lang="km"
                            value={draft.unitKm}
                            onChange={(e) => setDraft((d) => ({ ...d, unitKm: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-black/[.15] bg-card px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                          >
                            <option value="">—</option>
                            {[...new Set([...KHMER_SCALES, draft.unitKm].filter(Boolean))].map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-xs text-zinc-500">
                          Weight (grams)
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="e.g. 1000 for 1kg"
                            title="Lets Sales offer selling this by gram"
                            value={draft.weightGrams}
                            onChange={(e) => setDraft((d) => ({ ...d, weightGrams: e.target.value }))}
                            className="mt-0.5 w-full rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                          />
                        </label>
                      </div>

                      <div className="text-xs text-zinc-500">
                        Image
                        <div className="mt-1 flex flex-wrap items-start gap-4">
                          <div className="flex items-start gap-3">
                            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                              {p.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-400">
                                  No image
                                </div>
                              )}
                            </div>
                            <div className="flex w-44 flex-col gap-1.5">
                              <label className="cursor-pointer rounded border border-black/[.15] px-3 py-1.5 text-center text-sm text-foreground hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.06]">
                                {isPending ? "Uploading…" : p.image_url ? "Replace image" : "Upload image"}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  disabled={isPending}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0] ?? null;
                                    e.target.value = "";
                                    pickImage(p, file);
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                disabled={isPending || imageChoices.length === 0}
                                onClick={() => {
                                  setPickerOpen((v) => !v);
                                  setStockOpen(false);
                                }}
                                aria-expanded={pickerOpen}
                                className={`rounded border px-3 py-1.5 text-center text-sm text-foreground hover:bg-black/[.04] disabled:opacity-40 dark:hover:bg-white/[.06] ${
                                  pickerOpen ? "border-brand" : "border-black/[.15] dark:border-white/[.2]"
                                }`}
                              >
                                Choose from products
                              </button>
                              <button
                                type="button"
                                onClick={() => run(() => removeProductImageAction({ productId: p.id }))}
                                disabled={isPending || !p.image_url}
                                className="text-left text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40 dark:text-red-400"
                              >
                                Remove image
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setStockOpen((v) => !v);
                                setPickerOpen(false);
                              }}
                              aria-expanded={stockOpen}
                              title="This product's stock (the same number as the Stock column). Click to choose which product's stock it follows."
                              className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs hover:bg-black/[.04] dark:hover:bg-white/[.06] ${
                                stockOpen ? "border-brand" : "border-black/[.15] dark:border-white/[.2]"
                              }`}
                            >
                              <span className="text-zinc-500">
                                {p.stock_source_ids || p.stock_untracked ? "Stock · follows" : "Stock"}
                              </span>
                              <span
                                className={`text-sm font-semibold tabular-nums ${
                                  p.stock_untracked
                                    ? "text-zinc-400"
                                    : p.stock_quantity <= 0
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {p.stock_untracked ? "—" : p.stock_quantity}
                              </span>
                            </button>
                          </div>

                          {stockOpen && (
                            <div className="min-w-[18rem] flex-1 space-y-2 rounded-lg border border-black/[.1] bg-card p-3 shadow-sm dark:border-white/[.15]">
                              <input
                                type="text"
                                value={stockSearch}
                                onChange={(e) => setStockSearch(e.target.value)}
                                placeholder="Search products…"
                                className="w-full rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                              />
                              <ul className="max-h-72 overflow-y-auto pr-1">
                                {stockChoices
                                  .filter((c) => !c.size && c.name.toLowerCase().includes(stockSearch.trim().toLowerCase()))
                                  .map((c) => (
                                    <li key={`${c.source.siteProductId}::${c.source.variationId ?? ""}`}>
                                      <button
                                        type="button"
                                        disabled={isPending || !catalogId}
                                        onClick={() =>
                                          catalogId &&
                                          run(
                                            () =>
                                              setPosOnlyStockSourceAction({
                                                productId: p.id,
                                                catalogId,
                                                siteProductId: c.source.siteProductId,
                                                siteVariationId: c.source.variationId,
                                                name: c.name,
                                              }),
                                            () => setStockOpen(false)
                                          )
                                        }
                                        title={
                                          c.stock === null
                                            ? `${c.name} has no stock number on the website -- follows the POS count instead`
                                            : `Follow ${c.name}'s stock (${c.stock})`
                                        }
                                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm text-foreground hover:bg-black/[.05] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/[.07]"
                                      >
                                        {c.url ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={c.url}
                                            alt=""
                                            loading="lazy"
                                            className="size-7 shrink-0 rounded border border-black/[.1] object-cover dark:border-white/[.15]"
                                          />
                                        ) : (
                                          <span className="size-7 shrink-0 rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800" />
                                        )}
                                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                        <span
                                          className={`shrink-0 font-semibold tabular-nums ${
                                            c.stock === null
                                              ? "text-zinc-400"
                                              : c.stock <= 0
                                                ? "text-red-600 dark:text-red-400"
                                                : "text-emerald-600 dark:text-emerald-400"
                                          }`}
                                        >
                                          {c.stock === null ? "—" : c.stock}
                                        </span>
                                      </button>
                                    </li>
                                  ))}
                              </ul>
                              {(p.stock_source_ids || p.stock_untracked) && (
                                <div className="flex items-center justify-between gap-2 rounded-md bg-brand/10 px-2.5 py-1.5 text-xs">
                                  <span>
                                    Following <b>{p.stock_source_name ?? "another product"}</b> —{" "}
                                    {p.stock_untracked
                                      ? "it has no stock number, so this product isn't counted either."
                                      : "its stock is this product's stock."}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() =>
                                      run(() => unlinkPosOnlyStockAction({ productId: p.id }), () => setStockOpen(false))
                                    }
                                    className="shrink-0 font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                                  >
                                    Stop following
                                  </button>
                                </div>
                              )}
                              <p className="text-[11px] text-zinc-400">
                                Click a product to take its stock. From then on this product&apos;s stock always matches
                                it: a sale of this product also lowers it, and any change to it shows here. A product with
                                sizes uses its sizes added together. The picture is not changed.
                              </p>
                            </div>
                          )}
                          {pickerOpen && (
                            <div className="min-w-[18rem] flex-1 space-y-2 rounded-lg border border-black/[.1] bg-card p-3 shadow-sm dark:border-white/[.15]">
                              <input
                                type="text"
                                value={pickerSearch}
                                onChange={(e) => setPickerSearch(e.target.value)}
                                placeholder="Search products…"
                                className="w-full rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                              />
                              {/* Inline grid styles: a picture's own size must never stretch the table. */}
                              <div
                                className="overflow-y-auto pr-1"
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(auto-fill, minmax(6.5rem, 1fr))",
                                  gap: "12px 10px",
                                  maxHeight: "22rem",
                                }}
                              >
                                {choices.slice(0, 120).map((c) => (
                                  <button
                                    key={`${c.brand ?? ""}|${c.url ?? `no-image:${c.name}`}`}
                                    type="button"
                                    disabled={isPending}
                                    title={c.url ? `Use ${c.name}'s picture and name` : `Use ${c.name}'s name (it has no picture)`}
                                    onClick={() =>
                                      run(
                                        () =>
                                          setPosOnlyImageUrlAction({
                                            productId: p.id,
                                            imageUrl: c.url ?? "",
                                            name: c.name,
                                            nameKm: c.nameKm,
                                          }),
                                        () => {
                                          setPickerOpen(false);
                                          // the Edit box shows the new names too, so Save can't put the old ones back
                                          setDraft((d) => ({ ...d, name: c.name, nameKm: c.nameKm ?? "" }));
                                        }
                                      )
                                    }
                                    className="group flex min-w-0 flex-col gap-1 rounded-md p-0 text-left disabled:opacity-50"
                                  >
                                    <span
                                      className={`block overflow-hidden rounded-md border bg-zinc-100 transition group-hover:ring-2 group-hover:ring-brand dark:bg-zinc-800 ${
                                        c.url === p.image_url
                                          ? "border-brand ring-2 ring-brand"
                                          : "border-black/[.1] dark:border-white/[.15]"
                                      }`}
                                      style={{ width: "100%", aspectRatio: "1 / 1" }}
                                    >
                                      {c.url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={c.url}
                                          alt={c.name}
                                          loading="lazy"
                                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                        />
                                      ) : (
                                        <span className="flex h-full w-full items-center justify-center text-[11px] text-zinc-400">
                                          No image
                                        </span>
                                      )}
                                    </span>
                                    <span
                                      className="block text-[11px] leading-tight text-foreground"
                                      style={{
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                        overflow: "hidden",
                                      }}
                                    >
                                      {c.name}
                                      {c.brand ? <span className="text-zinc-400"> · {c.brand}</span> : null}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              <p className="text-[11px] text-zinc-400">
                                {choices.length === 0
                                  ? "No product matches."
                                  : `${choices.length} product${choices.length === 1 ? "" : "s"} · click one to use it${
                                      choices.length > 120 ? " (showing 120 — search to narrow)" : ""
                                    }`}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-full border border-black/[.15] px-5 py-1.5 text-sm font-medium text-foreground dark:border-white/[.2]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => saveEdit(p)}
                          className="rounded-full bg-brand px-5 py-1.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
                        >
                          {isPending ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {(() => {
        const target = products.find((x) => x.id === removingId);
        if (!target) return null;
        return (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
            onClick={() => {
              if (!isPending) setRemovingId(null);
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label="Delete this product?"
              className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                <TriangleAlert className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-foreground">Delete this product?</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {target.name ? `Removes “${target.name}”` : "Removes this product"} from the POS (Stock and Sales). This
                can’t be undone.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setRemovingId(null)}
                  className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () => deactivateProductAction({ productId: target.id }),
                      () => setRemovingId(null)
                    )
                  }
                  className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {preview && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={preview.title}
            className="relative max-h-[85vh] max-w-[85vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="Close"
              className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-lg hover:bg-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={preview.title}
              className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
            />
            <p className="mt-2 text-center text-sm font-medium text-white">{preview.title}</p>
          </div>
        </div>
      )}
    </>
  );
}
