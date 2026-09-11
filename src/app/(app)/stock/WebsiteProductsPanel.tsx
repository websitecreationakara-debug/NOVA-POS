"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { ProductWithStock } from "@/lib/supabase/queries";
import Dropdown from "@/components/Dropdown";
import { getCatalog } from "@/lib/websiteProducts/catalogs";
import type {
  WebsiteCatalogId,
  WebsiteProduct,
  WebsiteProductVariation,
  WebsiteProductWrite,
} from "@/lib/websiteProducts/types";
import {
  createWebsiteProductAction,
  deleteWebsiteProductAction,
  deleteWebsiteProductVariationAction,
  listWebsiteProductsAction,
  setVariationPriceAction,
  setVariationStockAction,
  updateWebsiteProductAction,
  uploadWebsiteImageAction,
} from "./websiteActions";

// Looked-up POS product for one entry (a simple product or one size of a
// "variable" one), keyed by `${site_product_id}::${variation_id}` -- "" for
// variation_id on a simple product's own link.
function posEntryKey(siteProductId: string, variationId: string): string {
  return `${siteProductId}::${variationId}`;
}

// How often to re-pull the storefront catalog so edits made on the website (or
// by another POS user) show up here without a manual refresh. The storefront API
// has no push channel, so this is a poll.
const POLL_INTERVAL_MS = 15_000;

// Rows-per-page choices for the table footer.
const PAGE_SIZE_OPTIONS = [10, 25, 50];

const fieldInputClass =
  "rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-black/40 dark:border-white/[.2] dark:focus:border-white/50";

// A form control with its label and (optional) hint stacked above it, so every
// box says what it's for even after you've typed in it.
function Field({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs font-medium text-zinc-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
        {hint && <span className="ml-1 font-normal text-zinc-400">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

const emptyForm: WebsiteProductWrite = {
  title: "",
  description: "",
  // price/stock left unset so their fields start empty (showing a "0"
  // placeholder) instead of a stuck literal 0 -- submitCreate defaults them
  // back to 0 if still blank.
  category_id: "",
  status: "draft",
  image_url: "",
  weight: "",
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

// A table row's worth of data: either a simple product as-is, or one
// size/flavor of a "variable" product. The storefront's product API has no
// way to write an individual variation's price/stock (confirmed: PATCH with a
// `variations` body 422s with "No writable fields in body"), so these rows
// are display-only for those two columns -- editing still happens wherever
// the site's own variations are actually managed.
type Entry = {
  product: WebsiteProduct;
  variation: WebsiteProductVariation | null;
  key: string;
};

function toEntries(list: WebsiteProduct[]): Entry[] {
  const out: Entry[] = [];
  for (const p of list) {
    const isVariable = p.type === "variable" || p.type === "variant";
    if (isVariable && p.variations && p.variations.length > 0) {
      for (const v of p.variations) {
        out.push({ product: p, variation: v, key: `${p.id}::${v.id}` });
      }
    } else {
      out.push({ product: p, variation: null, key: p.id });
    }
  }
  return out;
}

export default function WebsiteProductsPanel({
  catalogId,
  initialProducts,
  initialError,
  posProducts,
}: {
  catalogId: WebsiteCatalogId;
  initialProducts: WebsiteProduct[] | null;
  initialError: string | null;
  // The brand's own POS products, so a "variable" product's sizes can show
  // (and edit) the POS-linked product for that size, if one exists yet --
  // see setVariationPriceAction/setVariationStockAction.
  posProducts: ProductWithStock[];
}) {
  const router = useRouter();
  const [products, setProducts] = useState<WebsiteProduct[] | null>(initialProducts);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [outOfStockOnly, setOutOfStockOnly] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Product ids ticked for a bulk action.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WebsiteProductWrite>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, startTransition] = useTransition();

  // A brief bottom-right toast confirming a save (price/stock/status/delete) or
  // surfacing an action failure. `loadError` stays reserved for the initial
  // load / background poll failing -- those need to stay on screen.
  const [toast, setToast] = useState<{ id: number; text: string; kind: "ok" | "err" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "err" ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    // id keys the element so a new toast replays the slide-in even while one
    // is still on screen.
    setToast({ id: Date.now(), text, kind });
  }, []);

  // Set while the delete-confirmation dialog is open; carries which row the
  // user clicked Delete on. Replaces the old window.confirm().
  const [confirmTarget, setConfirmTarget] = useState<{
    p: WebsiteProduct;
    v: WebsiteProductVariation | null;
  } | null>(null);
  useEffect(() => {
    if (!confirmTarget) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirmTarget(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmTarget]);

  // Per-product unsaved edits to the inline price/stock fields. While a product
  // has a draft, polling leaves that field alone so it can't wipe what the user
  // is typing.
  const [drafts, setDrafts] = useState<
    Record<string, { price?: string; stock?: string; title?: string }>
  >({});

  const posByEntryKey = useMemo(() => {
    const map = new Map<string, ProductWithStock>();
    for (const p of posProducts) {
      if (p.site_link) map.set(posEntryKey(p.site_link.site_product_id, p.site_link.variation_id), p);
    }
    return map;
  }, [posProducts]);

  // Options for the "Category" picker in the add-product form. The storefront
  // APIs expose no category list, so start from the hand-maintained names in
  // catalogs.ts and add any other category id seen on a live product (labelled
  // by its id, since we have no name for it) so nothing already in use is
  // missing. A brand-new empty category still has to be created on the
  // storefront first.
  const categoryOptions = useMemo(() => {
    const known = getCatalog(catalogId).categories ?? [];
    const byId = new Map(known.map((c) => [c.id, c.label]));
    for (const p of products ?? []) {
      if (p.category_id && !byId.has(p.category_id)) {
        byId.set(p.category_id, `Unnamed category (${p.category_id.slice(0, 8)}…)`);
      }
    }
    return [...byId].map(([id, label]) => ({ id, label }));
  }, [catalogId, products]);

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

  // Manual pull (Refresh button, and after a create/delete). `refreshing`
  // drives the button's spinner + disabled state so the click has visible
  // feedback -- background polls never set it.
  function load() {
    setRefreshing(true);
    void refresh(false).finally(() => setRefreshing(false));
  }

  function setDraft(id: string, field: "price" | "stock" | "title", value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function clearDraft(id: string, field: "price" | "stock" | "title") {
    setDrafts((prev) => {
      const next = { ...prev };
      const entry = { ...next[id] };
      delete entry[field];
      if (Object.keys(entry).length === 0) delete next[id];
      else next[id] = entry;
      return next;
    });
  }

  function handleImagePick(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("That file isn't an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError("Image must be under 5MB");
      return;
    }
    setImageError(null);
    setUploadingImage(true);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      try {
        const { url } = await uploadWebsiteImageAction(fd);
        setForm((f) => ({ ...f, image_url: url }));
      } catch (e) {
        setImageError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploadingImage(false);
      }
    });
  }

  function submitCreate() {
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    setFormError(null);
    setImageError(null);
    startTransition(async () => {
      try {
        await createWebsiteProductAction(catalogId, {
          ...form,
          title: form.title.trim(),
          price: Number(form.price ?? 0) || 0,
          stock: Number(form.stock ?? 0) || 0,
        });
        setForm(emptyForm);
        setShowForm(false);
        notify(`Created “${form.title.trim()}”`);
        load();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Failed to create product");
      }
    });
  }

  function patch(id: string, input: Partial<WebsiteProductWrite>, label = "Saved") {
    setPendingId(id);
    startTransition(async () => {
      try {
        await updateWebsiteProductAction(catalogId, id, input);
        setPendingId(null);
        notify(label);
        load();
      } catch (e) {
        notify(e instanceof Error ? e.message : "Failed to update product", "err");
        setPendingId(null);
      }
    });
  }

  // Editing a "variable" product's size: keyed (pending/drafts) by the
  // variation's own id, not its parent product's -- variation ids are
  // distinct UUIDs, so this shares the same drafts/pendingId state as simple
  // products without collision. Writes the website's own variation first
  // (the source of truth for this size), then mirrors it into POS's own
  // linked product (creating it on first edit if needed) so Sales charges
  // the right amount.
  function patchVariationPrice(
    product: WebsiteProduct,
    variation: WebsiteProductVariation,
    linked: ProductWithStock | null,
    price: number
  ) {
    setPendingId(variation.id);
    startTransition(async () => {
      try {
        await setVariationPriceAction({
          catalogId,
          siteProductId: product.id,
          variationId: variation.id,
          title: `${product.title} (${variation.weight ?? ""})`.trim(),
          imageUrl: variation.image_url ?? product.image_url,
          alreadyLinked: linked != null,
          seedStock: variation.stock,
          price,
        });
        setPendingId(null);
        notify(`Price updated — ${product.title}${variation.weight ? ` (${variation.weight})` : ""}`);
        router.refresh();
      } catch (e) {
        notify(e instanceof Error ? e.message : "Failed to update this size's price", "err");
        setPendingId(null);
      }
    });
  }

  function patchVariationStock(
    product: WebsiteProduct,
    variation: WebsiteProductVariation,
    linked: ProductWithStock | null,
    stock: number
  ) {
    setPendingId(variation.id);
    startTransition(async () => {
      try {
        await setVariationStockAction({
          catalogId,
          siteProductId: product.id,
          variationId: variation.id,
          title: `${product.title} (${variation.weight ?? ""})`.trim(),
          imageUrl: variation.image_url ?? product.image_url,
          alreadyLinked: linked != null,
          seedPrice: linked?.price ?? variation.price,
          currentStock: linked?.stock_quantity ?? 0,
          stock,
        });
        setPendingId(null);
        notify(`Stock updated — ${product.title}${variation.weight ? ` (${variation.weight})` : ""}`);
        router.refresh();
      } catch (e) {
        notify(e instanceof Error ? e.message : "Failed to update this size's stock", "err");
        setPendingId(null);
      }
    });
  }

  // What a delete on this row actually does. For a "variable" product's size we
  // remove just that size via its own sub-route so the product and its other
  // sizes stay -- unless it's the last size left, where an empty variable
  // product is useless, so we drop the whole product instead. For a simple
  // product it's always the whole product.
  function deletePlan(p: WebsiteProduct, v: WebsiteProductVariation | null) {
    const lastSize = v != null && (p.variations?.length ?? 0) <= 1;
    const wholeProduct = v == null || lastSize;
    const sizeLabel = v?.weight ? `“${v.weight}”` : "this size";
    return {
      wholeProduct,
      lastSize,
      // Id the row's pending "…" is keyed on (variation id for a lone-size
      // delete, else product id -- sibling sizes share the product id).
      pendingId: v && !wholeProduct ? v.id : p.id,
      title: wholeProduct ? "Delete this product?" : "Delete this size?",
      body: !wholeProduct
        ? `Removes ${sizeLabel} of “${p.title}” from the website. This can’t be undone.`
        : lastSize
          ? `${sizeLabel} is the last size of “${p.title}”, so the whole product will be removed from the website. This can’t be undone.`
          : `Removes “${p.title}” from the website. This can’t be undone.`,
    };
  }

  // Clicking Delete just opens the confirmation dialog (see confirmTarget).
  function remove(p: WebsiteProduct, v: WebsiteProductVariation | null) {
    setConfirmTarget({ p, v });
  }

  // Runs the delete the dialog is confirming.
  function confirmRemove() {
    if (!confirmTarget) return;
    const { p, v } = confirmTarget;
    const plan = deletePlan(p, v);
    setPendingId(plan.pendingId);
    startTransition(async () => {
      try {
        if (v && !plan.wholeProduct) {
          await deleteWebsiteProductVariationAction(catalogId, p.id, v.id);
        } else {
          await deleteWebsiteProductAction(catalogId, p.id);
        }
        setPendingId(null);
        setConfirmTarget(null);
        notify(
          plan.wholeProduct
            ? `Deleted “${p.title}”`
            : `Deleted ${v?.weight ? `“${v.weight}”` : "the"} size of “${p.title}”`
        );
        load();
      } catch (e) {
        const detail = e instanceof Error ? e.message : "Failed to delete";
        notify(
          v && !plan.wholeProduct
            ? `Couldn't delete this size — the storefront may not support removing sizes one at a time yet. (${detail})`
            : detail,
          "err"
        );
        setPendingId(null);
        setConfirmTarget(null);
      }
    });
  }

  // Expand every "variable" product into one row per size/flavor -- its own
  // price/stock are meaningless at the parent level (always 0/null) -- then
  // search/filter over the resulting rows.
  const q = search.trim().toLowerCase();
  const allEntries = toEntries(products ?? []);
  const lowStockCount = allEntries.filter(({ product: p, variation: v }) => {
    const s = (v ? v.stock : p.stock) ?? 0;
    return s > 0 && s <= 5;
  }).length;
  const outOfStockCount = allEntries.filter(({ product: p, variation: v }) => {
    const s = (v ? v.stock : p.stock) ?? 0;
    return s <= 0;
  }).length;

  const filtered = allEntries.filter(({ product: p, variation: v }) => {
    const weight = v?.weight ?? p.weight;
    const stock = v ? v.stock : p.stock;
    return (
      (!q ||
        p.title.toLowerCase().includes(q) ||
        (weight ?? "").toLowerCase().includes(q) ||
        (p.taste_notes ?? "").toLowerCase().includes(q)) &&
      (!categoryFilter ||
        (categoryFilter === "__none__" ? !p.category_id : p.category_id === categoryFilter)) &&
      (!outOfStockOnly || (stock ?? 0) <= 0) &&
      (!lowStockOnly || ((stock ?? 0) > 0 && (stock ?? 0) <= 5))
    );
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Snap back to page 1 whenever the result set changes under the current page.
  const filterKey = `${q}|${categoryFilter}|${outOfStockOnly}|${lowStockOnly}|${pageSize}|${pageCount}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }
  const currentPage = Math.min(page, pageCount);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // --- Bulk selection --------------------------------------------------------
  const pageProductIds = useMemo(
    () => Array.from(new Set(paged.map((e) => e.product.id))),
    [paged]
  );
  const allOnPageSelected =
    pageProductIds.length > 0 && pageProductIds.every((id) => selected.has(id));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageProductIds.forEach((id) => next.delete(id));
      else pageProductIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function bulkSetStatus(status: WebsiteProductWrite["status"]) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        await updateWebsiteProductAction(catalogId, id, { status });
        ok++;
      } catch {
        /* keep going; report the tally at the end */
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    notify(
      ok === ids.length
        ? `${ok} product${ok === 1 ? "" : "s"} set to ${status === "published" ? "Published" : "Draft"}`
        : `${ok} of ${ids.length} updated — ${ids.length - ok} failed`,
      ok === ids.length ? "ok" : "err"
    );
    load();
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        await deleteWebsiteProductAction(catalogId, id);
        ok++;
      } catch {
        /* keep going */
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    setConfirmBulkDelete(false);
    notify(
      ok === ids.length
        ? `Deleted ${ok} product${ok === 1 ? "" : "s"}`
        : `Deleted ${ok} of ${ids.length} — ${ids.length - ok} failed`,
      ok === ids.length ? "ok" : "err"
    );
    load();
  }

  function exportCsv() {
    const rows = allEntries.map(({ product: p, variation: v }) => ({
      title: v?.weight ? `${p.title} (${v.weight})` : p.title,
      price: v ? v.price : p.price,
      stock: (v ? v.stock : p.stock) ?? "",
      status: p.status,
      category_id: p.category_id ?? "",
    }));
    const headers = ["title", "price", "stock", "status", "category_id"];
    const esc = (val: unknown) => {
      const s = String(val ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => esc(r[h as keyof typeof r])).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${getCatalog(catalogId).label.replace(/\s+/g, "-").toLowerCase()}-stock.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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
          className={`shrink-0 rounded px-3 py-1.5 text-sm font-medium ${
            showForm
              ? "border border-black/[.15] dark:border-white/[.2]"
              : "bg-brand text-black hover:brightness-95"
          }`}
        >
          {showForm ? "Cancel" : "+ Add product"}
        </button>
        <button
          onClick={exportCsv}
          className="flex shrink-0 items-center gap-1.5 rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]"
        >
          <Download className="size-3.5" />
          Export CSV
        </button>
        <button
          onClick={load}
          disabled={refreshing}
          className="flex shrink-0 items-center gap-1.5 rounded border border-black/[.15] px-3 py-1.5 text-sm disabled:opacity-60 dark:border-white/[.2]"
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <button
          onClick={() => {
            setLowStockOnly((v) => !v);
            setOutOfStockOnly(false);
          }}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
            lowStockOnly
              ? "border-amber-500 bg-amber-500 text-white"
              : "border-black/[.15] dark:border-white/[.2]"
          }`}
        >
          Low stock
          <span
            className={`rounded-full px-1.5 text-xs font-semibold ${
              lowStockOnly ? "bg-white/25" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            }`}
          >
            {lowStockCount}
          </span>
        </button>
        <button
          onClick={() => {
            setOutOfStockOnly((v) => !v);
            setLowStockOnly(false);
          }}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
            outOfStockOnly
              ? "border-red-500 bg-red-500 text-white"
              : "border-black/[.15] dark:border-white/[.2]"
          }`}
        >
          Out of stock
          <span
            className={`rounded-full px-1.5 text-xs font-semibold ${
              outOfStockOnly ? "bg-white/25" : "bg-red-500/15 text-red-600 dark:text-red-400"
            }`}
          >
            {outOfStockCount}
          </span>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <button
          type="button"
          onClick={() => setCategoryFilter("")}
          className={`rounded-full border px-3 py-1 text-xs ${
            categoryFilter === ""
              ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
              : "border-black/[.15] dark:border-white/[.2]"
          }`}
        >
          All
        </button>
        {categoryOptions.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryFilter(c.id)}
            className={`rounded-full border px-3 py-1 text-xs ${
              categoryFilter === c.id
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-black/[.15] dark:border-white/[.2]"
            }`}
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCategoryFilter("__none__")}
          className={`rounded-full border px-3 py-1 text-xs ${
            categoryFilter === "__none__"
              ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
              : "border-black/[.15] dark:border-white/[.2]"
          }`}
        >
          Uncategorized
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[.08] bg-brand/10 px-6 py-2.5 text-sm dark:border-white/[.145]">
          <span className="font-semibold">{selected.size} selected</span>
          <button
            onClick={() => bulkSetStatus("published")}
            disabled={bulkBusy}
            className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-white/[.2]"
          >
            Publish
          </button>
          <button
            onClick={() => bulkSetStatus("draft")}
            disabled={bulkBusy}
            className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-white/[.2]"
          >
            Set to Draft
          </button>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            disabled={bulkBusy}
            className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
          >
            Delete
          </button>
          {bulkBusy && <span className="text-xs text-zinc-500">Working…</span>}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs font-medium text-zinc-500 hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {showForm && (
        <div className="border-b border-black/[.08] bg-black/[.02] px-6 py-5 dark:border-white/[.145] dark:bg-white/[.02]">
          <h3 className="mb-4 text-sm font-semibold">New product</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 md:grid-cols-4">
            <Field label="Title" required className="col-span-2">
              <input
                type="text"
                placeholder="e.g. Hojicha Roasted Green Tea"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className={fieldInputClass}
              />
            </Field>
            <Field label="Price">
              <div className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1.5 focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50">
                <span className="select-none text-sm text-zinc-400">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  value={form.price ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      price: e.target.value === "" ? undefined : Number(e.target.value),
                    }))
                  }
                  className="w-full min-w-0 border-0 bg-transparent p-0 text-right text-sm tabular-nums outline-none"
                />
              </div>
            </Field>
            <Field label="Stock">
              <input
                type="number"
                min={0}
                placeholder="0"
                value={form.stock ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    stock: e.target.value === "" ? undefined : Number(e.target.value),
                  }))
                }
                className={`${fieldInputClass} text-right tabular-nums`}
              />
            </Field>
            <Field label="Status">
              <Dropdown
                value={form.status ?? "draft"}
                onChange={(v) =>
                  setForm((f) => ({ ...f, status: v as WebsiteProductWrite["status"] }))
                }
                options={[
                  { value: "draft", label: "Draft — hidden on the site" },
                  { value: "published", label: "Published — live on the site" },
                ]}
              />
            </Field>
            <Field label="Weight" hint="optional">
              <input
                type="text"
                placeholder="e.g. 500ml, 40g"
                value={form.weight ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
                className={fieldInputClass}
              />
            </Field>
            <Field label="Category" hint="optional">
              <Dropdown
                value={form.category_id ?? ""}
                onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
                options={[
                  { value: "", label: "— No category —" },
                  ...categoryOptions.map((c) => ({ value: c.id, label: c.label })),
                ]}
              />
            </Field>
            <Field label="Image" hint="optional" className="col-span-2 md:col-span-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                  {form.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                      No image
                    </div>
                  )}
                </div>
                <label className="cursor-pointer rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]">
                  {uploadingImage
                    ? "Uploading…"
                    : form.image_url
                      ? "Replace image"
                      : "Upload from computer"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      handleImagePick(file);
                    }}
                  />
                </label>
                {form.image_url && !uploadingImage && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, image_url: "" }))}
                    className="text-xs text-red-500"
                  >
                    Remove
                  </button>
                )}
                <input
                  type="text"
                  placeholder="or paste an image URL"
                  value={form.image_url ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                  className={`${fieldInputClass} min-w-[12rem] flex-1`}
                />
              </div>
              {imageError && <span className="mt-1 text-xs text-red-500">{imageError}</span>}
            </Field>
          </div>
          {formError && <p className="mt-3 text-xs text-red-500">{formError}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={submitCreate}
              className="rounded border border-black bg-black px-4 py-1.5 text-sm font-medium text-white dark:border-white dark:bg-white dark:text-black"
            >
              Create product
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded border border-black/[.15] px-4 py-1.5 text-sm dark:border-white/[.2]"
            >
              Cancel
            </button>
          </div>
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
                <th className="w-10 py-2 pl-6">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPageSelected}
                    onChange={toggleSelectPage}
                    className="align-middle accent-[var(--brand)]"
                  />
                </th>
                <th className="w-14 px-3 py-2 font-medium">Image</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Price</th>
                <th className="w-20 px-3 py-2 text-right font-medium">Stock</th>
                <th className="w-32 px-3 py-2 font-medium">Status</th>
                <th className="w-16 px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(({ product: p, variation: v, key }) => {
                // The POS product linked to this size, if anyone has already
                // sold it or edited it here before -- null means editing will
                // create one on the fly (see patchVariationPrice/Stock).
                const linked = v ? (posByEntryKey.get(posEntryKey(p.id, v.id)) ?? null) : null;
                const editId = v ? v.id : p.id;
                const currentPrice = v ? (linked?.price ?? v.price) : p.price;
                const currentStock = v ? (linked?.stock_quantity ?? v.stock ?? 0) : p.stock;
                const priceValue = drafts[editId]?.price ?? String(currentPrice);
                const stockValue = drafts[editId]?.stock ?? String(currentStock ?? 0);
                const imageUrl = v?.image_url ?? p.image_url;
                const weight = v?.weight ?? p.weight;
                // A size's own price/stock is POS's tracked value for it (see
                // patchVariationPrice/Stock) -- separate from, and never
                // written back to, the website's own listing for this size.
                const editTitle = v ? "Updates this size's price/stock on the website too" : undefined;
                return (
                  <tr
                    key={key}
                    className={`border-b border-black/[.06] align-top dark:border-white/[.08] ${
                      selected.has(p.id) ? "bg-brand/5" : ""
                    }`}
                  >
                    <td className="py-2 pl-6">
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.title}`}
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelected(p.id)}
                        className="align-middle accent-[var(--brand)]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                        {imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                            No img
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {/* Editable name. Keyed by p.id (not editId) so the sibling
                          size-rows of a "variable" product share one draft and
                          rename the parent together. */}
                      <input
                        type="text"
                        value={drafts[p.id]?.title ?? p.title}
                        disabled={pendingId === p.id}
                        onChange={(e) => setDraft(p.id, "title", e.target.value)}
                        onBlur={(e) => {
                          const title = e.target.value.trim();
                          if (title && title !== p.title) {
                            patch(p.id, { title }, "Name updated");
                          }
                          clearDraft(p.id, "title");
                        }}
                        className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-black/[.15] focus:border-black/40 focus:outline-none disabled:opacity-50 dark:hover:border-white/[.2] dark:focus:border-white/50"
                      />
                      {weight && <div className="text-xs text-zinc-400">{weight}</div>}
                      {p.taste_notes && (
                        <div className="break-words text-xs text-zinc-400">{p.taste_notes}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <label
                        title={editTitle}
                        className="inline-flex w-24 items-center gap-1 rounded border border-black/[.15] px-2 py-1 text-sm focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50"
                      >
                        <span className="select-none text-zinc-400">$</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={priceValue}
                          disabled={pendingId === editId}
                          onChange={(e) => setDraft(editId, "price", e.target.value)}
                          onBlur={(e) => {
                            const price = Number(e.target.value);
                            if (!Number.isNaN(price) && price !== currentPrice) {
                              if (v) patchVariationPrice(p, v, linked, price);
                              else patch(p.id, { price }, "Price updated");
                            }
                            clearDraft(editId, "price");
                          }}
                          className="w-full min-w-0 border-0 bg-transparent p-0 text-right tabular-nums outline-none"
                        />
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        title={editTitle}
                        value={stockValue}
                        disabled={pendingId === editId}
                        onChange={(e) => setDraft(editId, "stock", e.target.value)}
                        onBlur={(e) => {
                          const stock = Number(e.target.value);
                          if (!Number.isNaN(stock) && stock !== (currentStock ?? 0)) {
                            if (v) patchVariationStock(p, v, linked, stock);
                            else patch(p.id, { stock }, "Stock updated");
                          }
                          clearDraft(editId, "stock");
                        }}
                        className="w-16 rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm tabular-nums focus:border-black/40 focus:outline-none dark:border-white/[.2] dark:focus:border-white/50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {/* Colored pill; click toggles Published <-> Draft. */}
                      <button
                        type="button"
                        disabled={pendingId === p.id}
                        onClick={() => {
                          const status: WebsiteProductWrite["status"] =
                            p.status === "published" ? "draft" : "published";
                          patch(
                            p.id,
                            { status },
                            `Status set to ${status === "published" ? "Published" : "Draft"}`
                          );
                        }}
                        title="Click to toggle Published / Draft"
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                          p.status === "published"
                            ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                            : "bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20 dark:text-zinc-400"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            p.status === "published" ? "bg-emerald-500" : "bg-zinc-400"
                          }`}
                        />
                        {p.status === "published" ? "Published" : "Draft"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={pendingId === editId || pendingId === p.id}
                        onClick={() => remove(p, v)}
                        title="Delete product"
                        aria-label="Delete product"
                        className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950 dark:hover:text-red-400"
                      >
                        {pendingId === editId || pendingId === p.id ? (
                          "…"
                        ) : (
                          <Trash2 className="size-4" />
                        )}
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

      {products && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[.08] px-6 py-3 text-sm dark:border-white/[.145]">
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Items per page
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded border border-black/[.15] bg-card px-2 py-1 text-xs text-foreground dark:border-white/[.2]"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1 text-xs disabled:opacity-30 dark:border-white/[.2]"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </button>
            <span className="tabular-nums text-zinc-500">
              Page {currentPage} of {pageCount}
            </span>
            <button
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1 text-xs disabled:opacity-30 dark:border-white/[.2]"
            >
              Next
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:inset-x-auto sm:right-4 sm:justify-end">
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            onClick={() => setToast(null)}
            className="animate-toast-in flex w-full max-w-sm cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg shadow-black/[.08] dark:shadow-black/40"
          >
            <span
              className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full ${
                toast.kind === "err"
                  ? "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
                  : "bg-success-bg text-success"
              }`}
            >
              {toast.kind === "err" ? (
                <TriangleAlert className="size-3" />
              ) : (
                <Check className="size-3.5" strokeWidth={3} />
              )}
            </span>
            <p className="text-sm leading-snug font-medium text-foreground">{toast.text}</p>
          </div>
        </div>
      )}

      {confirmTarget &&
        (() => {
          const plan = deletePlan(confirmTarget.p, confirmTarget.v);
          const busy = pendingId === plan.pendingId;
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => {
                if (!busy) setConfirmTarget(null);
              }}
            >
              <div
                role="alertdialog"
                aria-modal="true"
                aria-label={plan.title}
                className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
                  <TriangleAlert className="h-6 w-6" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-foreground">{plan.title}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{plan.body}</p>
                <div className="mt-6 flex justify-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmTarget(null)}
                    className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={confirmRemove}
                    className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {confirmBulkDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!bulkBusy) setConfirmBulkDelete(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete selected products"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
              <TriangleAlert className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">
              Delete {selected.size} product{selected.size === 1 ? "" : "s"}?
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This removes them from the website for good. This can&apos;t be undone.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setConfirmBulkDelete(false)}
                className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={bulkDelete}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {bulkBusy ? "Deleting…" : "Delete all"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
