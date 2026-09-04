"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  WebsiteCatalogId,
  WebsiteProduct,
  WebsiteProductWrite,
} from "@/lib/websiteProducts/types";
import {
  createWebsiteProductAction,
  deleteWebsiteProductAction,
  listWebsiteProductsAction,
  updateWebsiteProductAction,
} from "./websiteActions";

// How often to re-pull the storefront catalog so edits made on the website (or
// by another POS user) show up here without a manual refresh. The storefront API
// has no push channel, so this is a poll.
const POLL_INTERVAL_MS = 15_000;

// Rows shown per page in the table.
const PAGE_SIZE = 10;

const emptyForm: WebsiteProductWrite = {
  title: "",
  description: "",
  price: 0,
  category_id: "",
  stock: 0,
  status: "draft",
  image_url: "",
  weight: "",
  taste_notes: "",
  type: "simple",
  featured: false,
};

// Stable key for "did the catalog actually change" — avoids re-rendering the
// table on every poll when nothing moved.
function catalogSignature(products: WebsiteProduct[]): string {
  return products
    .map(
      (p) =>
        `${p.id}:${p.updated_at ?? ""}:${p.price}:${p.sale_price ?? ""}:${p.stock ?? ""}:${p.status}:${p.featured ? 1 : 0}:${p.title}`
    )
    .join("|");
}

export default function WebsiteProductsPanel({
  catalogId,
  initialProducts,
  initialError,
}: {
  catalogId: WebsiteCatalogId;
  initialProducts: WebsiteProduct[] | null;
  initialError: string | null;
}) {
  const [products, setProducts] = useState<WebsiteProduct[] | null>(initialProducts);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WebsiteProductWrite>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Per-product unsaved edits to the inline price/stock fields. While a product
  // has a draft, polling leaves that field alone so it can't wipe what the user
  // is typing.
  const [drafts, setDrafts] = useState<Record<string, { price?: string; stock?: string }>>({});

  // Refs so the polling loop can read current state without re-subscribing.
  const signatureRef = useRef<string>(initialProducts ? catalogSignature(initialProducts) : "");
  const busyRef = useRef(false);
  const pendingIdRef = useRef(pendingId);
  const showFormRef = useRef(showForm);
  useEffect(() => {
    pendingIdRef.current = pendingId;
  }, [pendingId]);
  useEffect(() => {
    showFormRef.current = showForm;
  }, [showForm]);

  // Pull the catalog. `background` polls stay quiet: no spinner, transient
  // failures don't blow away the last-known-good list.
  const refresh = useCallback(
    async (background: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      if (!background) setLoadError(null);
      try {
        const data = await listWebsiteProductsAction(catalogId);
        const nextSig = catalogSignature(data);
        if (nextSig !== signatureRef.current) {
          signatureRef.current = nextSig;
          setProducts(data);
        }
        if (!background) setLoadError(null);
      } catch (e) {
        if (!background) {
          setLoadError(
            e instanceof Error ? e.message : "Failed to load website products"
          );
        }
      } finally {
        busyRef.current = false;
      }
    },
    [catalogId]
  );

  // Poll on an interval while the tab is visible; pull immediately whenever the
  // tab regains focus so a backgrounded POS catches up at once. Polls are
  // skipped while a mutation is in flight or the add form is open.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const canPoll = () =>
      document.visibilityState === "visible" &&
      pendingIdRef.current === null &&
      !showFormRef.current;

    const tick = () => {
      if (canPoll()) void refresh(true);
    };

    const start = () => {
      if (timer === null) timer = setInterval(tick, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (canPoll()) void refresh(true);
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tick);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tick);
    };
  }, [refresh]);

  function load() {
    void refresh(false);
  }

  function setDraft(id: string, field: "price" | "stock", value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function clearDraft(id: string, field: "price" | "stock") {
    setDrafts((prev) => {
      const next = { ...prev };
      const entry = { ...next[id] };
      delete entry[field];
      if (Object.keys(entry).length === 0) delete next[id];
      else next[id] = entry;
      return next;
    });
  }

  function submitCreate() {
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    setFormError(null);
    startTransition(async () => {
      try {
        await createWebsiteProductAction(catalogId, {
          ...form,
          title: form.title.trim(),
          price: Number(form.price) || 0,
          stock: form.stock === null || form.stock === undefined ? null : Number(form.stock),
        });
        setForm(emptyForm);
        setShowForm(false);
        load();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Failed to create product");
      }
    });
  }

  function patch(id: string, input: Partial<WebsiteProductWrite>) {
    setPendingId(id);
    startTransition(async () => {
      try {
        await updateWebsiteProductAction(catalogId, id, input);
        setPendingId(null);
        load();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to update product");
        setPendingId(null);
      }
    });
  }

  function remove(id: string, title: string) {
    if (!window.confirm(`Delete "${title}" from the website? This cannot be undone.`)) return;
    setPendingId(id);
    startTransition(async () => {
      try {
        await deleteWebsiteProductAction(catalogId, id);
        setPendingId(null);
        load();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to delete product");
        setPendingId(null);
      }
    });
  }

  // Dynamic search over title / weight / taste notes, then paginate.
  const q = search.trim().toLowerCase();
  const filtered = (products ?? []).filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      (p.weight ?? "").toLowerCase().includes(q) ||
      (p.taste_notes ?? "").toLowerCase().includes(q)
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Snap back to page 1 whenever the result set changes under the current page.
  const filterKey = `${q}|${pageCount}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <input
          type="text"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
        />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]"
        >
          {showForm ? "Cancel" : "Add product"}
        </button>
        <button
          onClick={load}
          className="shrink-0 rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]"
        >
          Refresh
        </button>
      </div>

      {showForm && (
        <div className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input
              type="text"
              placeholder="Title *"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Price"
              value={form.price ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="number"
              min={0}
              placeholder="Stock"
              value={form.stock ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value) }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <select
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as WebsiteProductWrite["status"] }))
              }
              className="rounded border border-black/[.15] bg-card px-2 py-1.5 text-sm dark:border-white/[.2]"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
            <input
              type="text"
              placeholder="Weight (e.g. 500ml)"
              value={form.weight ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Taste notes (e.g. Chili, Garlic)"
              value={form.taste_notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, taste_notes: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Category UUID (optional)"
              value={form.category_id ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Image URL"
              value={form.image_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <label className="flex items-center gap-1.5 text-sm text-zinc-500">
              <input
                type="checkbox"
                checked={form.featured ?? false}
                onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
              />
              Featured
            </label>
            <textarea
              placeholder="Description"
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="col-span-2 rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2] md:col-span-4"
              rows={2}
            />
          </div>
          {formError && <p className="mt-2 text-xs text-red-500">{formError}</p>}
          <button
            onClick={submitCreate}
            className="mt-3 rounded border border-black bg-black px-3 py-1.5 text-sm text-white dark:border-white dark:bg-white dark:text-black"
          >
            Create
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loadError && <p className="px-6 py-3 text-sm text-red-500">{loadError}</p>}
        {products === null && !loadError && (
          <p className="px-6 py-8 text-center text-sm text-zinc-500">Loading…</p>
        )}
        {products && (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
              <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
                <th className="px-6 py-2 font-medium">Image</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Price</th>
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Featured</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => {
                const priceValue = drafts[p.id]?.price ?? String(p.price);
                const stockValue = drafts[p.id]?.stock ?? String(p.stock ?? 0);
                return (
                  <tr
                    key={p.id}
                    className="border-b border-black/[.06] align-top dark:border-white/[.08]"
                  >
                    <td className="px-6 py-2">
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
                    </td>
                    <td className="px-6 py-2">
                      <div className="font-medium">{p.title}</div>
                      {p.weight && <div className="text-xs text-zinc-400">{p.weight}</div>}
                      {p.taste_notes && (
                        <div className="text-xs text-zinc-400">{p.taste_notes}</div>
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
                          disabled={pendingId === p.id}
                          onChange={(e) => setDraft(p.id, "price", e.target.value)}
                          onBlur={(e) => {
                            const price = Number(e.target.value);
                            if (!Number.isNaN(price) && price !== p.price) {
                              patch(p.id, { price });
                            }
                            clearDraft(p.id, "price");
                          }}
                          className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={stockValue}
                        disabled={pendingId === p.id}
                        onChange={(e) => setDraft(p.id, "stock", e.target.value)}
                        onBlur={(e) => {
                          const stock = Number(e.target.value);
                          if (!Number.isNaN(stock) && stock !== (p.stock ?? 0)) {
                            patch(p.id, { stock });
                          }
                          clearDraft(p.id, "stock");
                        }}
                        className="w-16 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={p.status}
                        disabled={pendingId === p.id}
                        onChange={(e) =>
                          patch(p.id, { status: e.target.value as WebsiteProductWrite["status"] })
                        }
                        className="rounded border border-black/[.15] bg-card px-2 py-1 text-sm dark:border-white/[.2]"
                      >
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={p.featured}
                        disabled={pendingId === p.id}
                        onChange={(e) => patch(p.id, { featured: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        disabled={pendingId === p.id}
                        onClick={() => remove(p.id, p.title)}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-500 disabled:opacity-40 dark:border-red-900"
                      >
                        {pendingId === p.id ? "…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500">
                    {q ? "No products match your search." : "No website products yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {products && pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-black/[.08] px-6 py-3 dark:border-white/[.145]">
          <button
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-black/[.15] disabled:opacity-30 dark:border-white/[.2]"
          >
            <ChevronLeft className="size-4" />
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setPage(n)}
              aria-current={n === currentPage ? "page" : undefined}
              className={`h-8 w-8 shrink-0 rounded border text-sm tabular-nums ${
                n === currentPage
                  ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                  : "border-black/[.15] dark:border-white/[.2]"
              }`}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= pageCount}
            aria-label="Next page"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-black/[.15] disabled:opacity-30 dark:border-white/[.2]"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
