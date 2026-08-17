"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Brand, Category } from "@/types/database";
import type { ProductWithStock } from "@/lib/supabase/queries";
import { adjustStockAction, setLowStockThresholdAction, uploadProductImageAction } from "./actions";

type Draft = { delta: string; reason: string };

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function StockClient({
  brands,
  currentBrand,
  categories,
  products,
}: {
  brands: Brand[];
  currentBrand: Brand;
  categories: Category[];
  products: ProductWithStock[];
}) {
  const router = useRouter();
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const visibleProducts = useMemo(() => {
    let list = products;
    if (activeCategoryId !== "all") {
      list = list.filter((p) => p.category_id === activeCategoryId);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
      );
    }
    if (lowStockOnly) {
      list = list.filter(
        (p) =>
          p.stock_quantity <= 0 ||
          (p.low_stock_threshold > 0 && p.stock_quantity <= p.low_stock_threshold)
      );
    }
    return list;
  }, [products, activeCategoryId, search, lowStockOnly]);

  function switchBrand(brandId: string) {
    router.push(`/stock?brand=${brandId}`);
  }

  function updateDraft(productId: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] ?? { delta: "", reason: "" }), [field]: value },
    }));
  }

  function applyAdjustment(productId: string) {
    const draft = drafts[productId];
    const delta = parseFloat(draft?.delta ?? "");
    if (!draft || Number.isNaN(delta) || delta === 0) {
      setErrors((prev) => ({ ...prev, [productId]: "Enter a non-zero amount" }));
      return;
    }
    if (!draft.reason.trim()) {
      setErrors((prev) => ({ ...prev, [productId]: "Reason required" }));
      return;
    }
    setErrors((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setPendingId(productId);
    startTransition(async () => {
      try {
        await adjustStockAction({ productId, delta, reason: draft.reason.trim() });
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[productId];
          return next;
        });
        router.refresh();
      } catch (e) {
        setErrors((prev) => ({
          ...prev,
          [productId]: e instanceof Error ? e.message : "Adjustment failed",
        }));
      } finally {
        setPendingId(null);
      }
    });
  }

  function handleImageChange(productId: string, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageErrors((prev) => ({ ...prev, [productId]: "Must be an image file" }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageErrors((prev) => ({ ...prev, [productId]: "Max 5MB" }));
      return;
    }
    setImageErrors((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setUploadingId(productId);
    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("file", file);
    startTransition(async () => {
      try {
        await uploadProductImageAction(formData);
        router.refresh();
      } catch (e) {
        setImageErrors((prev) => ({
          ...prev,
          [productId]: e instanceof Error ? e.message : "Upload failed",
        }));
      } finally {
        setUploadingId(null);
      }
    });
  }

  function saveThreshold(productId: string, currentThreshold: number) {
    const raw = thresholdDrafts[productId];
    if (raw === undefined) return;
    const threshold = parseInt(raw, 10);
    const clear = () =>
      setThresholdDrafts((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    if (Number.isNaN(threshold) || threshold < 0 || threshold === currentThreshold) {
      clear();
      return;
    }
    startTransition(async () => {
      try {
        await setLowStockThresholdAction({ productId, threshold });
        router.refresh();
      } finally {
        clear();
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <select
          className="rounded border border-black/[.15] bg-card px-3 py-1.5 text-sm text-foreground dark:border-white/[.2]"
          value={currentBrand.id}
          onChange={(e) => switchBrand(e.target.value)}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <h1 className="text-lg font-medium">Stock</h1>
        <div className="ml-auto flex items-center gap-3">
          <input
            type="text"
            placeholder="Search name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
          />
          <label className="flex items-center gap-1.5 text-sm text-zinc-500">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
            Low/out of stock only
          </label>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <button
          onClick={() => setActiveCategoryId("all")}
          className={`rounded-full border px-3 py-1 text-xs ${
            activeCategoryId === "all"
              ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
              : "border-black/[.15] dark:border-white/[.2]"
          }`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategoryId(c.id)}
            className={`rounded-full border px-3 py-1 text-xs ${
              activeCategoryId === c.id
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-black/[.15] dark:border-white/[.2]"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
            <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
              <th className="px-6 py-2 font-medium">Image</th>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Stock</th>
              <th className="px-3 py-2 font-medium">Low-stock at</th>
              <th className="px-3 py-2 font-medium">Adjust</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((p) => {
              const isOut = p.stock_quantity <= 0;
              const isLow =
                !isOut && p.low_stock_threshold > 0 && p.stock_quantity <= p.low_stock_threshold;
              const draft = drafts[p.id] ?? { delta: "", reason: "" };
              const thresholdValue = thresholdDrafts[p.id] ?? String(p.low_stock_threshold);
              return (
                <tr
                  key={p.id}
                  className="border-b border-black/[.06] align-top dark:border-white/[.08]"
                >
                  <td className="px-6 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                            No img
                          </div>
                        )}
                      </div>
                      <label className="cursor-pointer rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]">
                        {uploadingId === p.id ? "…" : p.image_url ? "Change" : "Add"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingId === p.id}
                          onChange={(e) => {
                            const file = e.target.files?.[0] ?? null;
                            e.target.value = "";
                            handleImageChange(p.id, file);
                          }}
                        />
                      </label>
                    </div>
                    {imageErrors[p.id] && (
                      <p className="mt-1 text-xs text-red-500">{imageErrors[p.id]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    {p.sku && <div className="text-xs text-zinc-400">{p.sku}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {formatMoney(p.price)} <span className="text-zinc-400">/ {p.unit}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">
                    {p.category_id ? (categoryById.get(p.category_id) ?? "—") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        isOut
                          ? "font-medium text-red-500"
                          : isLow
                            ? "font-medium text-amber-500"
                            : ""
                      }
                    >
                      {p.stock_quantity} {p.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      value={thresholdValue}
                      onChange={(e) => setThresholdDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      onBlur={() => saveThreshold(p.id, p.low_stock_threshold)}
                      className="w-16 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        placeholder="±qty"
                        value={draft.delta}
                        onChange={(e) => updateDraft(p.id, "delta", e.target.value)}
                        className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                      />
                      <input
                        type="text"
                        placeholder="Reason"
                        value={draft.reason}
                        onChange={(e) => updateDraft(p.id, "reason", e.target.value)}
                        className="w-32 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                      />
                      <button
                        disabled={pendingId === p.id}
                        onClick={() => applyAdjustment(p.id)}
                        className="rounded border border-black/[.15] px-2 py-1 text-xs disabled:opacity-40 dark:border-white/[.2]"
                      >
                        {pendingId === p.id ? "…" : "Apply"}
                      </button>
                    </div>
                    {errors[p.id] && <p className="mt-1 text-xs text-red-500">{errors[p.id]}</p>}
                  </td>
                </tr>
              );
            })}
            {visibleProducts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500">
                  No products match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
