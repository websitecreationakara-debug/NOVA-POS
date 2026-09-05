"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, User } from "lucide-react";
import type { Brand, Category, PaymentMethod } from "@/types/database";
import type { ProductWithStock } from "@/lib/supabase/queries";
import type { WebsiteProduct } from "@/lib/websiteProducts/types";
import SalesWebsiteGrid from "./SalesWebsiteGrid";
import type { SalesWebsiteCatalog } from "./page";
import {
  chargeOrder,
  searchCustomersByPhone,
  type CartLine,
  type ChargeResult,
  type CustomerSuggestion,
} from "./actions";
import { ensurePosProductForSiteProduct } from "./websiteActions";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

// Compares the query against individual words rather than the full
// product name -- normalizing edit distance by string length means a
// short query trivially scores "close" to any long name, so matching
// per-word keeps the comparison length-appropriate for typo tolerance.
function nameSimilarity(query: string, name: string): number {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let best = 0;
  for (const word of words) {
    const dist = levenshtein(query, word);
    const score = 1 - dist / Math.max(query.length, word.length, 1);
    if (score > best) best = score;
  }
  return best;
}

export default function SalesClient({
  brands,
  currentBrand,
  categories,
  products,
  websiteCatalog,
  initialSearch,
}: {
  brands: Brand[];
  currentBrand: Brand;
  categories: Category[];
  products: ProductWithStock[];
  websiteCatalog: SalesWebsiteCatalog | null;
  initialSearch: string;
}) {
  const router = useRouter();
  // Sales runs off the storefront catalog. The POS-catalog grid only shows as a
  // fallback for a brand that has no storefront wired up.
  const showWebsite = websiteCatalog !== null;
  // Site product id currently being linked to a new POS product on tap.
  const [linkingSiteProductId, setLinkingSiteProductId] = useState<string | null>(null);
  // POS products created this session by tapping an unlinked website product,
  // keyed by site product id -- lets a repeat tap skip the round trip.
  const [linkedThisSession, setLinkedThisSession] = useState<Map<string, ProductWithStock>>(
    new Map()
  );
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [search, setSearch] = useState(initialSearch);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const [minusAmount, setMinusAmount] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; phone: string } | null>(
    null
  );
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [phoneDropdownOpen, setPhoneDropdownOpen] = useState(false);
  const [receipt, setReceipt] = useState<ChargeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCharging, startCharging] = useTransition();
  const [, startLookup] = useTransition();
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, []);

  const isExistingCustomer = selectedCustomer?.phone === customerPhone.trim() && !!selectedCustomer;

  const q = search.trim().toLowerCase();
  const visibleProducts = useMemo(() => {
    // While searching, look across every category -- otherwise a match
    // sitting in a category other than the active tab silently disappears
    // and the empty state ("No products in this category") reads as if
    // the search came up empty when it didn't.
    let list =
      q || activeCategoryId === "all"
        ? products
        : products.filter((p) => p.category_id === activeCategoryId);
    if (q) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeCategoryId, q]);

  // "Did you mean" fallback for typos -- only worth computing once the
  // exact search has already come up empty, and only for queries long
  // enough that a fuzzy match means something.
  const suggestedProducts = useMemo(() => {
    if (!q || q.length < 2 || visibleProducts.length > 0) return [];
    return products
      .map((p) => ({ product: p, score: nameSimilarity(q, p.name) }))
      .filter((s) => s.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((s) => s.product);
  }, [products, q, visibleProducts.length]);

  // Jump back to page 1 whenever the result set changes underneath the
  // current page -- otherwise switching category/search can strand the
  // user on a page number that no longer has any products. Adjusted
  // during render (React's recommended pattern) rather than in an effect,
  // to avoid an extra render pass.
  const filterKey = `${activeCategoryId}|${q}|${pageSize}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(visibleProducts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedProducts = visibleProducts.slice(pageStart, pageStart + pageSize);

  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const discountPercentValue = Math.min(Math.max(parseFloat(discountPercent) || 0, 0), 100);
  const minusValue = Math.max(parseFloat(minusAmount) || 0, 0);
  const deliveryFeeValue = Math.max(parseFloat(deliveryFee) || 0, 0);
  const discountAmount = subtotal * (discountPercentValue / 100) + minusValue;
  const finalTotal = Math.max(subtotal - discountAmount + deliveryFeeValue, 0);

  function addToCart(product: ProductWithStock) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        { productId: product.id, name: product.name, unitPrice: product.price, quantity: 1 },
      ];
    });
  }

  // A website product is charged through the POS product it's linked to
  // (product_site_links) -- that's the id charge_order expects and the stock
  // row it decrements. Build the lookup from the catalog we already loaded,
  // plus anything linked on tap this session.
  const posBySiteProductId = useMemo(() => {
    const map = new Map<string, ProductWithStock>();
    for (const p of products) {
      if (p.site_link) map.set(p.site_link.site_product_id, p);
    }
    for (const [siteProductId, p] of linkedThisSession) map.set(siteProductId, p);
    return map;
  }, [products, linkedThisSession]);

  // site product id -> quantity currently in the Order, for the grid's
  // remaining-stock display.
  const cartQtyBySiteProduct = useMemo(() => {
    const posIdToSiteId = new Map<string, string>();
    for (const [siteId, pos] of posBySiteProductId) posIdToSiteId.set(pos.id, siteId);
    const map = new Map<string, number>();
    for (const line of cart) {
      const siteId = posIdToSiteId.get(line.productId);
      if (siteId) map.set(siteId, (map.get(siteId) ?? 0) + line.quantity);
    }
    return map;
  }, [cart, posBySiteProductId]);

  // Tapping a website product: if it already maps to a POS product, add it;
  // otherwise create + link one on the fly (in the storefront's brand), then
  // add. The created product shows up in Stock like any hand-linked one.
  async function addWebsiteProductToCart(wp: WebsiteProduct) {
    const known = posBySiteProductId.get(wp.id);
    if (known) {
      addToCart(known);
      return;
    }
    if (!websiteCatalog || linkingSiteProductId) return;
    setError(null);
    setLinkingSiteProductId(wp.id);
    try {
      const linked = await ensurePosProductForSiteProduct({
        catalogId: websiteCatalog.id,
        siteProductId: wp.id,
        title: wp.title,
        price: wp.price,
        imageUrl: wp.image_url,
        stock: wp.stock,
      });
      const asProduct = {
        id: linked.id,
        name: linked.name,
        price: linked.price,
        unit: linked.unit,
      } as ProductWithStock;
      setLinkedThisSession((prev) => new Map(prev).set(wp.id, asProduct));
      addToCart(asProduct);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add this website product");
    } finally {
      setLinkingSiteProductId(null);
    }
  }

  function renderProductCard(p: ProductWithStock) {
    const isOut = p.stock_quantity <= 0;
    const isLow = !isOut && p.low_stock_threshold > 0 && p.stock_quantity <= p.low_stock_threshold;
    return (
      <button
        key={p.id}
        onClick={() => addToCart(p)}
        className="flex flex-col items-start rounded-lg border border-black/[.08] p-4 text-left transition-colors hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
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
        <div className="font-medium">{p.name}</div>
        <div className="mt-1 text-sm text-zinc-500">
          {formatMoney(p.price)} / {p.unit}
        </div>
        <div
          className={`mt-1 text-xs ${isOut ? "text-red-500" : isLow ? "text-amber-500" : "text-zinc-400"}`}
        >
          {isOut
            ? "Out of stock"
            : isLow
              ? `Low stock — ${p.stock_quantity} left`
              : `${p.stock_quantity} in stock`}
        </div>
      </button>
    );
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  function switchBrand(brandId: string) {
    router.push(`/sales?brand=${brandId}`);
  }

  function handlePhoneChange(value: string) {
    setCustomerPhone(value);
    setSelectedCustomer(null);
    setPhoneDropdownOpen(true);

    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }
    searchDebounce.current = setTimeout(() => {
      startLookup(async () => {
        try {
          setSuggestions(await searchCustomersByPhone(trimmed));
        } catch {
          setSuggestions([]);
        }
      });
    }, 250);
  }

  function selectCustomer(customer: CustomerSuggestion) {
    setCustomerPhone(customer.phone);
    setCustomerName(customer.name);
    setCustomerAddress(customer.address ?? "");
    setSelectedCustomer({ id: customer.id, phone: customer.phone });
    setPhoneDropdownOpen(false);
  }

  function selectNewCustomer() {
    setSelectedCustomer(null);
    setPhoneDropdownOpen(false);
  }

  function handleCharge() {
    setError(null);
    const phone = customerPhone.trim();
    if (!phone) {
      setError("Customer phone number is required");
      return;
    }
    if (!isExistingCustomer && !customerName.trim()) {
      setError("Customer name is required to add a new customer");
      return;
    }
    startCharging(async () => {
      try {
        const result = await chargeOrder({
          brandId: currentBrand.id,
          lines: cart,
          paymentMethod,
          paymentReference: paymentReference || undefined,
          customerName,
          customerPhone: phone,
          customerAddress: customerAddress.trim() || undefined,
          discount: discountAmount || undefined,
          deliveryFee: deliveryFeeValue || undefined,
        });
        setReceipt(result);
        setCart([]);
        setPaymentReference("");
        setCustomerName("");
        setCustomerPhone("");
        setCustomerAddress("");
        setDiscountPercent("");
        setMinusAmount("");
        setDeliveryFee("");
        setSelectedCustomer(null);
        setSuggestions([]);
        router.refresh(); // pick up decremented stock counts for the next sale
      } catch (e) {
        setError(e instanceof Error ? e.message : "Charge failed");
      }
    });
  }

  if (receipt) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4 p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
            ✓
          </div>
          <h1 className="text-xl font-semibold">Sale complete</h1>
          <p className="text-zinc-500">{receipt.invoiceNumber ?? `Order #${receipt.orderId.slice(0, 8)}`}</p>
        </div>
        {receipt.stockSyncWarning && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {receipt.stockSyncWarning}
          </p>
        )}
        <div className="divide-y divide-black/[.08] rounded-lg border border-black/[.08] dark:divide-white/[.145] dark:border-white/[.145]">
          {receipt.lines.map((l) => (
            <div key={l.productId} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {l.quantity} × {l.name}
              </span>
              <span>{formatMoney(l.unitPrice * l.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span>{formatMoney(receipt.total)}</span>
        </div>
        <Link
          href={`/invoice/${receipt.orderId}`}
          target="_blank"
          className="rounded-full border border-black/[.15] px-6 py-2 text-center dark:border-white/[.2]"
        >
          View / print invoice
        </Link>
        <button
          className="rounded-full bg-black px-6 py-2 text-white dark:bg-white dark:text-black"
          onClick={() => setReceipt(null)}
        >
          New sale
        </button>
      </div>
    );
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
        <h1 className="text-lg font-medium">Sales</h1>
        {!showWebsite && (
          <input
            type="text"
            placeholder="Search name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto w-64 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
          />
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {showWebsite && websiteCatalog ? (
          <SalesWebsiteGrid
            key={websiteCatalog.id}
            catalogId={websiteCatalog.id}
            initialProducts={websiteCatalog.products}
            initialError={websiteCatalog.error}
            categories={websiteCatalog.categories}
            onSelect={addWebsiteProductToCart}
            pendingSiteProductId={linkingSiteProductId}
            cartQtyBySiteProduct={cartQtyBySiteProduct}
          />
        ) : (
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mb-4">
            <div
              className="flex flex-wrap gap-2"
              style={categoriesExpanded ? undefined : { maxHeight: "5rem", overflow: "hidden" }}
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
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategoryId(c.id)}
                  className={`rounded-full border px-4 py-1.5 text-sm ${
                    activeCategoryId === c.id
                      ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-black/[.15] dark:border-white/[.2]"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            {categories.length > 10 && (
              <button
                onClick={() => setCategoriesExpanded((v) => !v)}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-black dark:hover:text-white"
              >
                {categoriesExpanded ? (
                  <>
                    Show fewer categories <ChevronUp className="size-3.5" />
                  </>
                ) : (
                  <>
                    Show all {categories.length} categories <ChevronDown className="size-3.5" />
                  </>
                )}
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {pagedProducts.map(renderProductCard)}
            {visibleProducts.length === 0 && (
              <p className="col-span-full text-sm text-zinc-500">
                {q ? "No products match your search." : "No products in this category."}
              </p>
            )}
          </div>

          {suggestedProducts.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">
                Did you mean
              </p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {suggestedProducts.map(renderProductCard)}
              </div>
            </div>
          )}

          {visibleProducts.length > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
              <label className="flex items-center gap-2">
                Show
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded border border-black/[.15] bg-card px-2 py-1 text-sm text-foreground dark:border-white/[.2]"
                >
                  {[10, 20, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                per page
              </label>
              <div className="flex items-center gap-3">
                <span>
                  {pageStart + 1}–{Math.min(pageStart + pageSize, visibleProducts.length)} of{" "}
                  {visibleProducts.length}
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={currentPage <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded border border-black/[.15] p-1 disabled:opacity-30 dark:border-white/[.2]"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    disabled={currentPage >= pageCount}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-black/[.15] p-1 disabled:opacity-30 dark:border-white/[.2]"
                    aria-label="Next page"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
        )}

        <aside className="flex w-96 flex-col border-l border-black/[.08] dark:border-white/[.145]">
          <div className="border-b border-black/[.08] px-4 py-3 font-medium dark:border-white/[.145]">
            Order
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            {cart.length === 0 && (
              <p className="mt-4 text-sm text-zinc-500">Tap a product to add it.</p>
            )}
            {cart.map((line) => (
              <div key={line.productId} className="flex items-center justify-between py-2 text-sm">
                <div className="flex-1">
                  <div>{line.name}</div>
                  <div className="text-zinc-500">{formatMoney(line.unitPrice)} each</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="h-6 w-6 rounded border border-black/[.15] dark:border-white/[.2]"
                    onClick={() => updateQuantity(line.productId, -1)}
                  >
                    −
                  </button>
                  <span className="w-4 text-center">{line.quantity}</span>
                  <button
                    className="h-6 w-6 rounded border border-black/[.15] dark:border-white/[.2]"
                    onClick={() => updateQuantity(line.productId, 1)}
                  >
                    +
                  </button>
                  <button
                    className="ml-1 text-zinc-400 hover:text-red-500"
                    onClick={() => removeLine(line.productId)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-black/[.08] px-4 py-3 dark:border-white/[.145]">
            <div className="flex justify-between text-sm text-zinc-500">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-zinc-500">
                <span>Discount</span>
                <span>-{formatMoney(discountAmount)}</span>
              </div>
            )}
            {deliveryFeeValue > 0 && (
              <div className="flex justify-between text-sm text-zinc-500">
                <span>Delivery</span>
                <span>{formatMoney(deliveryFeeValue)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatMoney(finalTotal)}</span>
            </div>

            <div className="mt-4 flex gap-2">
              <div className="relative flex-1">
                <input
                  type="tel"
                  required
                  autoComplete="off"
                  className="w-full rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                  placeholder="Phone number *"
                  value={customerPhone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  onFocus={() => setPhoneDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setPhoneDropdownOpen(false), 150)}
                />
                {phoneDropdownOpen && customerPhone.trim().length > 0 && (
                  <div className="absolute top-full left-0 z-10 mt-1 max-h-64 w-64 overflow-y-auto rounded border border-black/[.15] bg-white shadow-lg dark:border-white/[.2] dark:bg-zinc-900">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={selectNewCustomer}
                      className="flex w-full items-center gap-2 border-b border-black/[.08] px-3 py-2 text-left text-sm hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
                    >
                      <Plus className="size-4" />
                      New
                    </button>
                    {suggestions.map((c) => (
                      <button
                        type="button"
                        key={c.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectCustomer(c)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/[.03] dark:hover:bg-white/[.05]"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                          {c.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.photoUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <User className="size-3.5 text-zinc-500" />
                          )}
                        </span>
                        <span className="flex flex-col">
                          <span>{c.phone}</span>
                          <span className="text-xs text-zinc-500">{c.name}</span>
                        </span>
                      </button>
                    ))}
                    {suggestions.length === 0 && customerPhone.trim().length >= 3 && (
                      <p className="px-3 py-2 text-xs text-zinc-500">No matches — pick New to add them.</p>
                    )}
                  </div>
                )}
              </div>
              <input
                className="flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                placeholder={isExistingCustomer ? "Customer name" : "Customer name *"}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <input
              className="mt-2 w-full rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
              placeholder="Address (optional)"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="Discount %"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                className="w-1/3 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="Minus $"
                value={minusAmount}
                onChange={(e) => setMinusAmount(e.target.value)}
                className="w-1/3 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="Delivery $"
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value)}
                className="w-1/3 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
              />
            </div>
            {isExistingCustomer && (
              <p className="mt-1 text-xs text-green-600">Existing customer — reusing their record.</p>
            )}
            {!isExistingCustomer && customerPhone.trim().length > 0 && (
              <p className="mt-1 text-xs text-amber-500">New customer — will be added on charge.</p>
            )}

            <div className="mt-2 flex gap-2">
              <button
                className={`flex-1 rounded-full border py-1.5 text-sm ${
                  paymentMethod === "cash"
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/[.15] dark:border-white/[.2]"
                }`}
                onClick={() => setPaymentMethod("cash")}
              >
                Cash
              </button>
              <button
                className={`flex-1 rounded-full border py-1.5 text-sm ${
                  paymentMethod === "bank_qr"
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-black/[.15] dark:border-white/[.2]"
                }`}
                onClick={() => setPaymentMethod("bank_qr")}
              >
                Bank / QR
              </button>
            </div>

            {paymentMethod === "bank_qr" && (
              <input
                className="mt-2 w-full rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                placeholder="Reference number (optional)"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            )}

            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

            <button
              disabled={cart.length === 0 || isCharging || !customerPhone.trim()}
              onClick={handleCharge}
              className="mt-4 w-full rounded-full bg-green-600 py-2.5 font-medium text-white disabled:opacity-40"
            >
              {isCharging ? "Charging…" : `Charge ${formatMoney(finalTotal)}`}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
