"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WebsiteCatalogId, WebsiteProduct } from "@/lib/websiteProducts/types";
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
// re-render the grid.
function catalogSignature(products: WebsiteProduct[]): string {
  return products
    .map((p) => `${p.id}:${p.price}:${p.sale_price ?? ""}:${p.stock ?? ""}:${p.status}:${p.title}:${p.image_url ?? ""}`)
    .join("|");
}

export default function SalesWebsiteGrid({
  catalogId,
  initialProducts,
  initialError,
  categories,
  onSelect,
  pendingSiteProductId,
}: {
  catalogId: WebsiteCatalogId;
  initialProducts: WebsiteProduct[] | null;
  initialError: string | null;
  // Category filter chips for this storefront ({ id: category_id, label }).
  categories: { id: string; label: string }[];
  onSelect: (product: WebsiteProduct) => void;
  // Site product id currently being linked to a POS product (brief spinner).
  pendingSiteProductId: string | null;
}) {
  const [products, setProducts] = useState<WebsiteProduct[] | null>(initialProducts);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [search, setSearch] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
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

  // Page the filtered view at two rows. Reset to page 1 whenever the result set
  // changes underneath the current page (React's during-render adjust pattern).
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const filterKey = `${q}|${activeCategoryId}|${pageCount}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
        <div className="mb-4 flex flex-wrap gap-2">
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

      {products && visible.length === 0 && (
        <p className="text-sm text-zinc-500">
          {q
            ? "No website products match your search."
            : activeCategoryId !== "all"
              ? "No products in this category."
              : "No website products yet."}
        </p>
      )}

      {products && visible.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {paged.map((p) => {
            const onSale = p.sale_price != null && p.sale_price < p.price;
            const isOut = p.stock != null && p.stock <= 0;
            const pending = pendingSiteProductId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                disabled={pending}
                className="flex flex-col items-start rounded-lg border border-black/[.08] p-4 text-left transition-colors hover:bg-black/[.03] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.05]"
              >
                <div className="mb-2 aspect-square w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                      No image
                    </div>
                  )}
                </div>
                {/* Fixed-height text block so every card is the same height and
                    the pager below never shifts between pages. */}
                <div className="line-clamp-2 h-12 font-medium">{p.title}</div>
                <div className="mt-1 text-sm text-zinc-500">
                  {onSale ? (
                    <>
                      <span className="line-through">{formatMoney(p.price)}</span>{" "}
                      <span className="text-green-600 dark:text-green-500">
                        {formatMoney(p.sale_price as number)}
                      </span>
                    </>
                  ) : (
                    formatMoney(p.price)
                  )}
                </div>
                <div className={`mt-1 text-xs ${isOut ? "text-red-500" : "text-zinc-400"}`}>
                  {p.stock == null ? "Stock untracked" : isOut ? "Out of stock" : `${p.stock} in stock`}
                </div>
                <div className="mt-1 text-xs text-amber-500">
                  {pending ? (
                    <span className="text-zinc-400">Adding…</span>
                  ) : p.status !== "published" ? (
                    "Draft"
                  ) : (
                    " "
                  )}
                </div>
              </button>
            );
          })}
          {/* Keep a short last page the same height as a full one. */}
          {Array.from({ length: Math.max(0, PAGE_SIZE - paged.length) }).map((_, i) => (
            <div key={`ph-${i}`} aria-hidden className="invisible rounded-lg border p-4">
              <div className="mb-2 aspect-square w-full" />
              <div className="h-12" />
              <div className="mt-1 h-5" />
              <div className="mt-1 h-4" />
              <div className="mt-1 h-4" />
            </div>
          ))}
        </div>
      )}

      {products && pageCount > 1 && (
        <div
          ref={pagerRef}
          className="mt-5 flex flex-wrap items-center justify-center gap-1.5"
        >
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-black/[.15] disabled:opacity-30 dark:border-white/[.2]"
          >
            <ChevronLeft className="size-4" />
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => goToPage(n)}
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
