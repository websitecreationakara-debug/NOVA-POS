"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, TriangleAlert, X } from "lucide-react";
import type { Brand, Category } from "@/types/database";
import type { ProductWithStock } from "@/lib/supabase/queries";
import type { WebsiteCatalogData } from "./page";
import {
  adjustStockAction,
  createCategoryAction,
  createProductAction,
  deactivateProductAction,
  deleteCategoryAction,
  linkProductToSiteAction,
  removeProductImageAction,
  renameProductAction,
  searchSiteProductForLinkAction,
  setLowStockThresholdAction,
  setProductCategoryAction,
  setProductPriceAction,
  uploadProductImageAction,
} from "./actions";
import WebsiteProductsPanel from "./WebsiteProductsPanel";

type SiteProductCandidate = { id: string; title: string; stock: number | null; type: string };

type Draft = { delta: string };

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 font-medium hover:text-foreground"
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

export default function StockClient({
  brands,
  currentBrand,
  categories,
  products,
  websiteCatalog,
}: {
  brands: Brand[];
  currentBrand: Brand;
  categories: Category[];
  products: ProductWithStock[];
  websiteCatalog: WebsiteCatalogData | null;
}) {
  const router = useRouter();
  // Stock is managed against the storefront catalog. The POS-catalog view only
  // shows as a fallback for a brand with no storefront wired up.
  const showWebsite = websiteCatalog !== null;
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    sku: "",
    price: "",
    unit: "pcs",
    categoryId: "",
  });
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [linkingProductId, setLinkingProductId] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<SiteProductCandidate[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkApplyingId, setLinkApplyingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<string | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"name" | "price" | "category" | "stock" | "threshold" | null>(
    null
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [, startTransition] = useTransition();

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  function toggleSort(key: "name" | "price" | "category" | "stock" | "threshold") {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
    }
  }

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
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
        if (sortKey === "price") return (a.price - b.price) * dir;
        if (sortKey === "stock") return (a.stock_quantity - b.stock_quantity) * dir;
        if (sortKey === "threshold") return (a.low_stock_threshold - b.low_stock_threshold) * dir;
        const nameA = categoryName.get(a.category_id ?? "") ?? "";
        const nameB = categoryName.get(b.category_id ?? "") ?? "";
        return nameA.localeCompare(nameB) * dir;
      });
    }
    return list;
  }, [products, activeCategoryId, search, lowStockOnly, sortKey, sortDir, categoryName]);

  // Page-level count (not filtered by category/search) so the low-stock
  // banner reflects the whole brand, not just whatever's currently visible.
  // Excludes quantity 0 -- most products here have never had a real count
  // entered and sit at 0 by default, so treating that as "low" would make
  // the banner permanent noise instead of a real signal.
  //
  // For a brand with a storefront, the site's own `stock` field (what the
  // Website Products panel below shows and edits) is the number staff
  // actually act on -- counting from the internal POS stock_levels table
  // instead would count products that aren't even linked to the site, and
  // disagree with what the panel's own "Low stock" button finds.
  const lowStockCount = useMemo(() => {
    if (showWebsite && websiteCatalog?.products) {
      return websiteCatalog.products.filter((p) => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= 5).length;
    }
    return products.filter(
      (p) =>
        p.stock_quantity > 0 && p.low_stock_threshold > 0 && p.stock_quantity <= p.low_stock_threshold
    ).length;
  }, [products, showWebsite, websiteCatalog]);
  // Same source as lowStockCount above -- the live site's stock for a brand
  // with a storefront, otherwise the internal POS table.
  const outOfStockCount = useMemo(() => {
    if (showWebsite && websiteCatalog?.products) {
      return websiteCatalog.products.filter((p) => (p.stock ?? 0) <= 0).length;
    }
    return products.filter((p) => p.stock_quantity <= 0).length;
  }, [products, showWebsite, websiteCatalog]);

  const categoryProductCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      if (!p.category_id) continue;
      map.set(p.category_id, (map.get(p.category_id) ?? 0) + 1);
    }
    return map;
  }, [products]);

  function switchBrand(brandId: string) {
    router.push(`/stock?brand=${brandId}`);
  }

  function updateDraft(productId: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] ?? { delta: "" }), [field]: value },
    }));
  }

  function applyAdjustment(productId: string) {
    const draft = drafts[productId];
    const delta = parseFloat(draft?.delta ?? "");
    if (!draft || Number.isNaN(delta) || delta === 0) {
      setErrors((prev) => ({ ...prev, [productId]: "Enter a non-zero amount" }));
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
        await adjustStockAction({ productId, delta });
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

  function handleRemoveImage(productId: string) {
    setRemovingId(productId);
    startTransition(async () => {
      try {
        await removeProductImageAction({ productId });
        router.refresh();
      } catch (e) {
        setImageErrors((prev) => ({
          ...prev,
          [productId]: e instanceof Error ? e.message : "Remove failed",
        }));
      } finally {
        setRemovingId(null);
      }
    });
  }

  async function handleDownloadImage(imageUrl: string, productName: string) {
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const ext = imageUrl.split(".").pop()?.split(/[?#]/)[0] || "jpg";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${productName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(imageUrl, "_blank");
    }
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

  function saveName(productId: string, currentName: string) {
    const raw = nameDrafts[productId];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const clear = () =>
      setNameDrafts((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    if (!trimmed || trimmed === currentName) {
      clear();
      return;
    }
    startTransition(async () => {
      try {
        await renameProductAction({ productId, name: trimmed });
        router.refresh();
      } finally {
        clear();
      }
    });
  }

  async function runLinkSearch(query: string) {
    setLinkSearching(true);
    setLinkError(null);
    try {
      const results = await searchSiteProductForLinkAction({ site: currentBrand.slug, query });
      setLinkResults(results);
      if (results.length === 0) setLinkError("No matches found on the website.");
    } catch {
      setLinkError("Search failed");
    } finally {
      setLinkSearching(false);
    }
  }

  function openLinkPanel(productId: string, productName: string) {
    setLinkingProductId(productId);
    setLinkQuery(productName);
    setLinkResults([]);
    setLinkError(null);
    runLinkSearch(productName);
  }

  function closeLinkPanel() {
    setLinkingProductId(null);
    setLinkQuery("");
    setLinkResults([]);
    setLinkError(null);
  }

  function applyLink(productId: string, candidate: SiteProductCandidate) {
    if (candidate.type === "variable") {
      setLinkError(
        "This website product is sold in sizes/variants -- not supported for sync yet."
      );
      return;
    }
    setLinkApplyingId(candidate.id);
    startTransition(async () => {
      try {
        await linkProductToSiteAction({
          productId,
          site: currentBrand.slug,
          siteProductId: candidate.id,
          matchedName: candidate.title,
          siteStock: candidate.stock,
        });
        closeLinkPanel();
        router.refresh();
      } catch {
        setLinkError("Failed to link");
      } finally {
        setLinkApplyingId(null);
      }
    });
  }

  function deleteProduct(productId: string) {
    setDeletingId(productId);
    startTransition(async () => {
      try {
        await deactivateProductAction({ productId });
        router.refresh();
      } finally {
        setDeletingId(null);
        setConfirmDeleteId(null);
      }
    });
  }

  function changeCategory(productId: string, categoryId: string) {
    startTransition(async () => {
      await setProductCategoryAction({ productId, categoryId: categoryId || null });
      router.refresh();
    });
  }

  function submitNewCategory() {
    const name = newCategoryName.trim();
    if (!name) {
      setCategoryError("Name is required");
      return;
    }
    setCategoryError(null);
    setIsAddingCategory(true);
    startTransition(async () => {
      try {
        await createCategoryAction({ brandId: currentBrand.id, name });
        setNewCategoryName("");
        setShowAddCategory(false);
        router.refresh();
      } catch (e) {
        setCategoryError(e instanceof Error ? e.message : "Failed to add category");
      } finally {
        setIsAddingCategory(false);
      }
    });
  }

  function cancelAddCategory() {
    setShowAddCategory(false);
    setNewCategoryName("");
    setCategoryError(null);
  }

  function deleteCategory(categoryId: string) {
    setDeletingCategoryId(categoryId);
    startTransition(async () => {
      try {
        await deleteCategoryAction({ categoryId });
        if (activeCategoryId === categoryId) setActiveCategoryId("all");
        router.refresh();
      } finally {
        setDeletingCategoryId(null);
        setConfirmDeleteCategoryId(null);
      }
    });
  }

  function submitNewProduct() {
    const name = newProduct.name.trim();
    const price = parseFloat(newProduct.price);
    if (!name) {
      setAddError("Name is required");
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      setAddError("Enter a valid price");
      return;
    }
    setAddError(null);
    setIsAdding(true);
    startTransition(async () => {
      try {
        await createProductAction({
          brandId: currentBrand.id,
          categoryId: newProduct.categoryId || null,
          name,
          sku: newProduct.sku || null,
          price,
          unit: newProduct.unit,
        });
        setNewProduct({ name: "", sku: "", price: "", unit: "pcs", categoryId: "" });
        setShowAddForm(false);
        router.refresh();
      } catch (e) {
        setAddError(e instanceof Error ? e.message : "Failed to add product");
      } finally {
        setIsAdding(false);
      }
    });
  }

  function savePrice(productId: string, currentPrice: number) {
    const raw = priceDrafts[productId];
    if (raw === undefined) return;
    const price = parseFloat(raw);
    const clear = () =>
      setPriceDrafts((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    if (Number.isNaN(price) || price < 0 || price === currentPrice) {
      clear();
      return;
    }
    startTransition(async () => {
      try {
        await setProductPriceAction({ productId, price });
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
        {!showWebsite && (
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
          <button
            type="button"
            onClick={() => {
              setShowAddForm((v) => !v);
              setAddError(null);
            }}
            className="rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]"
          >
            {showAddForm ? "Cancel" : "+ Add Product"}
          </button>
        </div>
        )}
      </header>
      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            {lowStockCount > 0 &&
              `${lowStockCount} product${lowStockCount === 1 ? "" : "s"} low on stock (5 or fewer left)`}
            {lowStockCount > 0 && outOfStockCount > 0 && " · "}
            {outOfStockCount > 0 &&
              `${outOfStockCount} product${outOfStockCount === 1 ? "" : "s"} out of stock`}
          </span>
          {!showWebsite && (
            <button
              type="button"
              onClick={() => setLowStockOnly(true)}
              className="ml-auto shrink-0 rounded-full border border-amber-300 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
            >
              Show them
            </button>
          )}
        </div>
      )}
      {showWebsite && websiteCatalog ? (
        <WebsiteProductsPanel
          key={websiteCatalog.id}
          catalogId={websiteCatalog.id}
          initialProducts={websiteCatalog.products}
          initialError={websiteCatalog.error}
        />
      ) : (
      <>
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
        {categories.map((c) => {
          const count = categoryProductCounts.get(c.id) ?? 0;
          if (confirmDeleteCategoryId === c.id) {
            return (
              <span
                key={c.id}
                className="flex items-center gap-1.5 rounded-full border border-red-500 px-3 py-1 text-xs"
              >
                <span className="text-zinc-500">
                  Delete &quot;{c.name}&quot;
                  {count > 0 ? ` (${count} product${count === 1 ? "" : "s"} → No category)` : ""}?
                </span>
                <button
                  type="button"
                  disabled={deletingCategoryId === c.id}
                  onClick={() => deleteCategory(c.id)}
                  className="font-medium text-red-500"
                >
                  {deletingCategoryId === c.id ? "…" : "Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteCategoryId(null)}
                  className="text-zinc-500"
                >
                  No
                </button>
              </span>
            );
          }
          return (
            <span key={c.id} className="group flex items-center gap-0.5">
              <button
                onClick={() => setActiveCategoryId(c.id)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  activeCategoryId === c.id
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/[.15] dark:border-white/[.2]"
                }`}
              >
                {c.name}
              </button>
              <button
                type="button"
                title="Delete category"
                onClick={() => setConfirmDeleteCategoryId(c.id)}
                className="rounded-full p-0.5 text-zinc-400 opacity-0 hover:text-red-500 group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        {showAddCategory ? (
          <span className="flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewCategory();
                if (e.key === "Escape") cancelAddCategory();
              }}
              placeholder="Category name"
              className="w-32 rounded border border-black/[.15] bg-transparent px-2 py-1 text-xs dark:border-white/[.2]"
            />
            <button
              type="button"
              disabled={isAddingCategory}
              onClick={submitNewCategory}
              className="rounded-full border border-black/[.15] px-2.5 py-1 text-xs dark:border-white/[.2]"
            >
              {isAddingCategory ? "…" : "Add"}
            </button>
            <button type="button" onClick={cancelAddCategory} className="text-xs text-zinc-500">
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddCategory(true)}
            className="rounded-full border border-dashed border-black/[.25] px-3 py-1 text-xs text-zinc-500 dark:border-white/[.3]"
          >
            + New category
          </button>
        )}
        {categoryError && <p className="w-full text-xs text-red-500">{categoryError}</p>}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
            <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
              <th className="px-6 py-2 font-medium">Image</th>
              <th className="px-3 py-2">
                <SortHeader
                  label="Product"
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                />
              </th>
              <th className="px-3 py-2">
                <SortHeader
                  label="Price"
                  active={sortKey === "price"}
                  dir={sortDir}
                  onClick={() => toggleSort("price")}
                />
              </th>
              <th className="px-3 py-2">
                <SortHeader
                  label="Category"
                  active={sortKey === "category"}
                  dir={sortDir}
                  onClick={() => toggleSort("category")}
                />
              </th>
              <th className="px-3 py-2">
                <SortHeader
                  label="Stock"
                  active={sortKey === "stock"}
                  dir={sortDir}
                  onClick={() => toggleSort("stock")}
                />
              </th>
              <th className="px-3 py-2">
                <SortHeader
                  label="Low-stock at"
                  active={sortKey === "threshold"}
                  dir={sortDir}
                  onClick={() => toggleSort("threshold")}
                />
              </th>
              <th className="px-3 py-2 font-medium">Adjust</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((p) => {
              const isOut = p.stock_quantity <= 0;
              const isLow =
                !isOut && p.low_stock_threshold > 0 && p.stock_quantity <= p.low_stock_threshold;
              const draft = drafts[p.id] ?? { delta: "" };
              const thresholdValue = thresholdDrafts[p.id] ?? String(p.low_stock_threshold);
              const priceValue = priceDrafts[p.id] ?? String(p.price);
              const nameValue = nameDrafts[p.id] ?? p.name;
              return (
                <Fragment key={p.id}>
                <tr
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
                      <div className="flex flex-col items-start gap-1">
                        <label className="cursor-pointer rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]">
                          {uploadingId === p.id ? "…" : p.image_url ? "Change" : "Add"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploadingId === p.id || removingId === p.id}
                            onChange={(e) => {
                              const file = e.target.files?.[0] ?? null;
                              e.target.value = "";
                              handleImageChange(p.id, file);
                            }}
                          />
                        </label>
                        {p.image_url && (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]"
                              onClick={() => handleDownloadImage(p.image_url!, p.name)}
                            >
                              Download
                            </button>
                            <button
                              type="button"
                              disabled={removingId === p.id || uploadingId === p.id}
                              className="rounded border border-black/[.15] px-2 py-1 text-xs text-red-500 dark:border-white/[.2]"
                              onClick={() => handleRemoveImage(p.id)}
                            >
                              {removingId === p.id ? "…" : "Remove"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {imageErrors[p.id] && (
                      <p className="mt-1 text-xs text-red-500">{imageErrors[p.id]}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={nameValue}
                      onChange={(e) =>
                        setNameDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      onBlur={() => saveName(p.id, p.name)}
                      className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-black/[.15] focus:border-black/[.3] dark:hover:border-white/[.2] dark:focus:border-white/[.4]"
                    />
                    {p.sku && <div className="text-xs text-zinc-400">{p.sku}</div>}
                    {p.site_link ? (
                      <div className="mt-1 text-xs text-green-600 dark:text-green-500">
                        🔗 Linked ({p.site_link.site})
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openLinkPanel(p.id, p.name)}
                        className="mt-1 text-xs text-blue-600 underline dark:text-blue-400"
                      >
                        Link to website
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-400">$</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={priceValue}
                        onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        onBlur={() => savePrice(p.id, p.price)}
                        className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                      />
                      <span className="text-zinc-400">/ {p.unit}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.category_id ?? ""}
                      onChange={(e) => changeCategory(p.id, e.target.value)}
                      className="rounded border border-black/[.15] bg-card px-2 py-1 text-sm text-foreground dark:border-white/[.2]"
                    >
                      <option value="">No category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
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
                  <td className="px-3 py-2">
                    {confirmDeleteId === p.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={deletingId === p.id}
                          onClick={() => deleteProduct(p.id)}
                          className="rounded border border-red-500 px-2 py-1 text-xs text-red-500"
                        >
                          {deletingId === p.id ? "…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="rounded border border-black/[.15] px-2 py-1 text-xs text-red-500 dark:border-white/[.2]"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
                {linkingProductId === p.id && (
                  <tr className="border-b border-black/[.06] bg-black/[.02] dark:border-white/[.08] dark:bg-white/[.03]">
                    <td colSpan={8} className="px-6 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-zinc-500">
                          Linking to {currentBrand.name}&apos;s website:
                        </span>
                        <input
                          type="text"
                          value={linkQuery}
                          onChange={(e) => setLinkQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") runLinkSearch(linkQuery);
                          }}
                          className="w-56 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                        />
                        <button
                          type="button"
                          onClick={() => runLinkSearch(linkQuery)}
                          disabled={linkSearching}
                          className="rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]"
                        >
                          {linkSearching ? "Searching…" : "Search"}
                        </button>
                        <button
                          type="button"
                          onClick={closeLinkPanel}
                          className="rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]"
                        >
                          Cancel
                        </button>
                      </div>
                      {linkError && <p className="mt-2 text-xs text-red-500">{linkError}</p>}
                      {linkResults.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                          {linkResults.map((c) => (
                            <li
                              key={c.id}
                              className="flex items-center justify-between gap-2 rounded border border-black/[.1] px-3 py-1.5 text-sm dark:border-white/[.15]"
                            >
                              <span>
                                {c.title}{" "}
                                <span className="text-xs text-zinc-400">
                                  (stock: {c.stock ?? "untracked"}
                                  {c.type === "variable" ? ", has size variants" : ""})
                                </span>
                              </span>
                              <button
                                type="button"
                                disabled={linkApplyingId === c.id}
                                onClick={() => applyLink(p.id, c)}
                                className="rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]"
                              >
                                {linkApplyingId === c.id ? "…" : "Link"}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {visibleProducts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-sm text-zinc-500">
                  No products match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
