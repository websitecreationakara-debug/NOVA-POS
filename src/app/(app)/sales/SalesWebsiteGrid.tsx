"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, UtensilsCrossed } from "lucide-react";
import type {
  WebsiteCatalogId,
  WebsiteProduct,
  WebsiteProductVariation,
} from "@/lib/websiteProducts/types";
import { listWebsiteProductsAction } from "../stock/websiteActions";

// useLayoutEffect on the client, useEffect on the server (avoids the SSR warning).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Same cadence the Stock > Website panel polls at: the storefront API has no
// push channel, so re-pull on an interval to catch edits made on the website
// or by another POS user.
const POLL_INTERVAL_MS = 15_000;

// Two rows of the lg:grid-cols-4 grid. Once a filtered view has more than this,
// it's paged so the cashier never scrolls a long wall of products.
const PAGE_SIZE = 8;

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// Cheap "did anything move" check so a poll that returns identical data doesn't
// re-render the grid. Folds in each variation's own price/stock so a change
// to just one size of a "variable" product is still picked up.
function catalogSignature(products: WebsiteProduct[]): string {
  return products
    .map((p) => {
      const variationsSig = (p.variations ?? [])
        .map((v) => `${v.id}:${v.price}:${v.sale_price ?? ""}:${v.stock ?? ""}`)
        .join(",");
      return `${p.id}:${p.price}:${p.sale_price ?? ""}:${p.stock ?? ""}:${p.status}:${p.title}:${p.image_url ?? ""}:${variationsSig}`;
    })
    .join("|");
}

// A card's worth of sellable data: either a simple product as-is, or one
// specific size/flavor of a "variable" product. `key` uniquely identifies the
// card (and, for a variation, doubles as the composite id used to look up its
// own POS product link -- see SalesClient's posByEntryKey).
type Entry = {
  product: WebsiteProduct;
  variation: WebsiteProductVariation | null;
  key: string;
};

// Expand every "variable"/"variant" product with real variations into one
// entry per size/flavor -- its parent's own price/stock are always 0/null, so
// selling it as a single card would always show "$0 / Stock untracked".
// Everything else (including a "variable" product with no variations data)
// passes through as a single entry, unchanged.
function toEntries(list: WebsiteProduct[]): Entry[] {
  const out: Entry[] = [];
  for (const p of list) {
    const isVariable = p.type === "variable" || p.type === "variant";
    if (isVariable && p.variations && p.variations.length > 0) {
      for (const v of p.variations) out.push({ product: p, variation: v, key: `${p.id}::${v.id}` });
    } else {
      out.push({ product: p, variation: null, key: p.id });
    }
  }
  return out;
}

export default function SalesWebsiteGrid({
  catalogId,
  initialProducts,
  initialError,
  categories,
  onSelect,
  pendingEntryKey,
  cartQtyByEntryKey,
}: {
  catalogId: WebsiteCatalogId;
  initialProducts: WebsiteProduct[] | null;
  initialError: string | null;
  // Category filter chips for this storefront ({ id: category_id, label }).
  categories: { id: string; label: string }[];
  // Passes the specific variation tapped, or null for a simple product.
  onSelect: (product: WebsiteProduct, variation: WebsiteProductVariation | null) => void;
  // Entry key currently being linked to a POS product (brief spinner).
  pendingEntryKey: string | null;
  // How many of each entry are sitting in the Order right now, so the card
  // can show remaining-after-this-sale stock.
  cartQtyByEntryKey: Map<string, number>;
}) {
  const [products, setProducts] = useState<WebsiteProduct[] | null>(initialProducts);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [search, setSearch] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [page, setPage] = useState(1);

  const signatureRef = useRef<string>(initialProducts ? catalogSignature(initialProducts) : "");
  const busyRef = useRef(false);

  // Keep the viewport fixed when paging: remember where the pager sits before
  // the page change, then nudge the scroll container by however much it moved.
  const scrollerRef = useRef<HTMLElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const anchorTopRef = useRef<number | null>(null);

  function goToPage(next: number) {
    anchorTopRef.current = pagerRef.current?.getBoundingClientRect().top ?? null;
    setPage(next);
  }

  // Re-pull the storefront catalog on an interval (it has no push channel) so
  // edits made on the website or by another POS user show up without a manual
  // refresh. Background polls stay quiet -- a transient failure keeps the
  // last-known-good list.
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
          setLoadError(e instanceof Error ? e.message : "Failed to load website products");
        }
      } finally {
        busyRef.current = false;
      }
    },
    [catalogId]
  );

  // Poll while the tab is visible; pull immediately on focus so a backgrounded
  // POS catches up at once.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const canPoll = () => document.visibilityState === "visible";
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
        tick();
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

  // A charge just went through: router.refresh() gave us fresh initialProducts
  // with the decremented stock -- adopt it now instead of waiting for the poll
  // (React's "adjust state when a prop changes during render" pattern).
  const initialSig = catalogSignature(initialProducts ?? []);
  const [prevInitialSig, setPrevInitialSig] = useState(initialSig);
  if (initialSig !== prevInitialSig) {
    setPrevInitialSig(initialSig);
    setProducts(initialProducts);
  }

  const q = search.trim().toLowerCase();
  const all = products ?? [];

  // Only show a chip if the catalog has products in it right now.
  const knownIds = new Set(categories.map((c) => c.id));
  const countByCategory = new Map<string, number>();
  let uncategorised = 0;
  for (const p of all) {
    if (p.category_id && knownIds.has(p.category_id)) {
      countByCategory.set(p.category_id, (countByCategory.get(p.category_id) ?? 0) + 1);
    } else {
      uncategorised += 1;
    }
  }
  const chips = categories.filter((c) => (countByCategory.get(c.id) ?? 0) > 0);
  const showChips = chips.length > 0;

  const visible = all.filter((p) => {
    // While searching, look across every category so a match in another chip
    // doesn't silently disappear.
    if (!q && activeCategoryId !== "all") {
      if (activeCategoryId === "__uncategorised") {
        if (p.category_id && knownIds.has(p.category_id)) return false;
      } else if (p.category_id !== activeCategoryId) {
        return false;
      }
    }
    return !q || p.title.toLowerCase().includes(q);
  });

  // Expand each visible product into its sellable card(s) -- a "variable"
  // product becomes one entry per size/flavor -- before paging.
  const entries = toEntries(visible);

  // Page the filtered view at two rows. Reset to page 1 whenever the result set
  // changes underneath the current page (React's during-render adjust pattern).
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const filterKey = `${q}|${activeCategoryId}|${pageCount}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }
  const currentPage = Math.min(page, pageCount);
  const paged = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // After the paged grid re-renders, restore the pager to the same on-screen
  // spot it was at when clicked, so the view doesn't jump up or down.
  useIsoLayoutEffect(() => {
    const anchor = anchorTopRef.current;
    anchorTopRef.current = null;
    if (anchor == null) return;
    const after = pagerRef.current?.getBoundingClientRect().top;
    const scroller = scrollerRef.current;
    if (after == null || !scroller) return;
    const delta = after - anchor;
    if (delta !== 0) scroller.scrollTop += delta;
  }, [currentPage]);

  return (
    <main ref={scrollerRef} className="flex-1 overflow-y-auto p-6">
      {showChips && (
        // Wrap onto a few rows -- no horizontal scrolling. Capped at ~3 rows
        // with a toggle so a long list doesn't push the products down the page.
        <div className="mb-4">
          <div
            className="flex flex-wrap gap-2"
            style={categoriesExpanded ? undefined : { maxHeight: "7.5rem", overflow: "hidden" }}
          >
            <button
              onClick={() => setActiveCategoryId("all")}
              className={`rounded-full border px-4 py-1.5 text-sm ${
                activeCategoryId === "all"
                  ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                  : "border-black/[.15] dark:border-white/[.2]"
              }`}
            >
              All
            </button>
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategoryId(c.id)}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  activeCategoryId === c.id
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/[.15] dark:border-white/[.2]"
                }`}
              >
                {c.label}
              </button>
            ))}
            {uncategorised > 0 && (
              <button
                onClick={() => setActiveCategoryId("__uncategorised")}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  activeCategoryId === "__uncategorised"
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/[.15] dark:border-white/[.2]"
                }`}
              >
                Other
              </button>
            )}
          </div>
          {chips.length + (uncategorised > 0 ? 1 : 0) > 9 && (
            <button
              onClick={() => setCategoriesExpanded((v) => !v)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-white"
            >
              {categoriesExpanded ? (
                <>
                  Show fewer <ChevronUp className="size-3.5" />
                </>
              ) : (
                <>
                  Show all categories <ChevronDown className="size-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <input
          type="text"
          placeholder="Search website products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
        />
      </div>

      {loadError && <p className="mb-4 text-sm text-red-500">{loadError}</p>}
      {products === null && !loadError && <p className="text-sm text-zinc-500">Loading…</p>}

      {products && entries.length === 0 && (
        <p className="text-sm text-zinc-500">
          {q
            ? "No website products match your search."
            : activeCategoryId !== "all"
              ? "No products in this category."
              : "No website products yet."}
        </p>
      )}

      {products && entries.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {paged.map((entry) => {
            const { product: p, variation: v, key } = entry;
            const price = v ? v.price : p.price;
            const salePrice = v ? v.sale_price : p.sale_price;
            const stock = v ? v.stock : p.stock;
            const imageUrl = v?.image_url ?? p.image_url;
            const onSale = salePrice != null && salePrice < price;
            // Show stock minus what's already in the Order, so staff see what's
            // left after this sale. The real decrement happens on Charge.
            const inCart = cartQtyByEntryKey.get(key) ?? 0;
            const remaining = stock == null ? null : stock - inCart;
            const isOut = remaining != null && remaining <= 0;
            const pending = pendingEntryKey === key;
            // A "variable" product shows up as several near-identical cards
            // (same photo, same name) -- one per option. `optionLabel` is the
            // one pill always shown under the name so no card looks
            // half-finished: the weight if there is one, else the flavour, else
            // just its position in the set. `photoBadge` is a bonus second cue
            // used only when a variation carries BOTH a weight and a flavour --
            // it takes the flavour so the two never show the same text twice.
            const isVariation = v != null;
            const siblingIndex = isVariation
              ? p.variations?.findIndex((x) => x.id === v.id) ?? -1
              : -1;
            const weightLabel = v?.weight?.trim() || null;
            const flavorLabel = v?.flavor?.trim() || null;
            const optionLabel = isVariation
              ? weightLabel ??
                flavorLabel ??
                (siblingIndex >= 0 ? `Option ${siblingIndex + 1}` : null)
              : null;
            const photoBadge =
              isVariation && weightLabel && flavorLabel ? flavorLabel : null;
            return (
              <button
                key={key}
                onClick={() => onSelect(p, v)}
                disabled={pending}
                className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors hover:bg-black/[.03] disabled:opacity-50 dark:hover:bg-white/[.05] ${
                  isVariation
                    ? "border-amber-400/60 bg-amber-50/50 dark:border-amber-400/25 dark:bg-amber-400/[.05]"
                    : "border-black/[.08] dark:border-white/[.145]"
                }`}
              >
                <div className="relative mb-2.5 aspect-square w-full overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-300 dark:text-zinc-600">
                      <UtensilsCrossed className="size-8" />
                    </div>
                  )}
                  {photoBadge && (
                    <span className="absolute top-2 left-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white shadow-sm">
                      {photoBadge}
                    </span>
                  )}
                  {p.status !== "published" && !pending && (
                    <span className="absolute top-2 right-2 rounded-full bg-zinc-700/90 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                      Draft
                    </span>
                  )}
                  {(isOut || pending) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/55">
                      <span className="rounded-full bg-zinc-800/90 px-2.5 py-1 text-xs font-bold text-white">
                        {pending ? "Adding…" : "Out of stock"}
                      </span>
                    </div>
                  )}
                </div>
                {/* Fixed 2-line title box (h-12 + leading-6) so every card is
                    the same height regardless of name length. A variation size
                    sits on its own line below, never folded into the title. */}
                <div className="line-clamp-2 h-12 leading-6 font-medium">{p.title}</div>
                <div className="mt-1 flex min-h-6 items-center">
                  {optionLabel && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                      {optionLabel}
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {onSale ? (
                    <>
                      <span className="font-normal text-zinc-400 line-through">
                        {formatMoney(price)}
                      </span>{" "}
                      <span className="text-green-600 dark:text-green-500">
                        {formatMoney(salePrice as number)}
                      </span>
                    </>
                  ) : (
                    formatMoney(price)
                  )}
                </div>
                <div className={`mt-1 text-xs ${isOut ? "text-red-500" : "text-zinc-400"}`}>
                  {remaining == null
                    ? "Stock untracked"
                    : isOut
                      ? "Out of stock"
                      : `${remaining} in stock`}
                </div>
              </button>
            );
          })}
          {/* Keep a short last page the same height as a full one. */}
          {Array.from({ length: Math.max(0, PAGE_SIZE - paged.length) }).map((_, i) => (
            <div key={`ph-${i}`} aria-hidden className="invisible rounded-xl border p-3">
              <div className="mb-2.5 aspect-square w-full" />
              <div className="h-12" />
              <div className="mt-1 h-6" />
              <div className="h-5" />
              <div className="mt-1 h-4" />
            </div>
          ))}
        </div>
      )}

      {products && pageCount > 1 && (
        <div ref={pagerRef} className="mt-5 flex items-center justify-center gap-3 text-sm">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-black/[.15] disabled:opacity-30 dark:border-white/[.2]"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular-nums text-zinc-500">
            Page {currentPage} of {pageCount}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pageCount}
            aria-label="Next page"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-black/[.15] disabled:opacity-30 dark:border-white/[.2]"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </main>
  );
}
