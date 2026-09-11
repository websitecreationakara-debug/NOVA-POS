"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  ShoppingCart,
  User,
  UtensilsCrossed,
} from "lucide-react";
import type { Brand, Category, PaymentMethod } from "@/types/database";
import type { ProductWithStock } from "@/lib/supabase/queries";
import type { WebsiteProduct, WebsiteProductVariation } from "@/lib/websiteProducts/types";
import SalesWebsiteGrid from "./SalesWebsiteGrid";
import type { SalesWebsiteCatalog } from "./page";
import {
  chargeOrder,
  searchCustomersByPhone,
  type CartLine,
  type ChargeResult,
  type CustomerSuggestion,
} from "./actions";
import { updateOrderAction } from "@/app/(app)/orders/actions";
import { ensurePosProductForSiteProduct } from "./websiteActions";
import { notifySaleCharged } from "@/lib/saleCharged";

// An existing order opened for editing via /sales?editOrder=<id> -- the
// checkout loads with this cart, customer and totals, and "Update order"
// charges the change back instead of creating a new sale.
export type EditOrderSeed = {
  orderId: string;
  invoiceNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  // Stored discount dollar amount and delivery fee from the order.
  discount: number;
  deliveryFee: number;
  // Requested delivery as an ISO timestamp, or "" for none.
  deliveryAt: string;
  note: string;
  lines: CartLine[];
};

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

// Local calendar date, `n` days from today, as YYYY-MM-DD.
function dateOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

// `now` as the "YYYY-MM-DDTHH:MM" value <input type="datetime-local"> uses.
function nowLocalMinute(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return `${d.toLocaleDateString("en-CA")}T${d.toTimeString().slice(0, 5)}`;
}

// Same "YYYY-MM-DDTHH:MM" local value, but from an ISO timestamp.
function isoToLocalMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setSeconds(0, 0);
  return `${d.toLocaleDateString("en-CA")}T${d.toTimeString().slice(0, 5)}`;
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
  editOrder = null,
}: {
  brands: Brand[];
  currentBrand: Brand;
  categories: Category[];
  products: ProductWithStock[];
  websiteCatalog: SalesWebsiteCatalog | null;
  initialSearch: string;
  editOrder?: EditOrderSeed | null;
}) {
  const router = useRouter();
  // Sales runs off the storefront catalog. The POS-catalog grid only shows as a
  // fallback for a brand that has no storefront wired up.
  const showWebsite = websiteCatalog !== null;
  // Entry key (site product id, or `${siteProductId}::${variationId}` for one
  // size of a "variable" product) currently being linked to a new POS product
  // on tap.
  const [linkingEntryKey, setLinkingEntryKey] = useState<string | null>(null);
  // POS products created this session by tapping an unlinked website product
  // (or one size of a variable one), keyed by entry key -- lets a repeat tap
  // skip the round trip.
  const [linkedThisSession, setLinkedThisSession] = useState<Map<string, ProductWithStock>>(
    new Map()
  );
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [search, setSearch] = useState(initialSearch);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [cart, setCart] = useState<CartLine[]>(() => editOrder?.lines ?? []);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [note, setNote] = useState(() => editOrder?.note ?? "");
  const [customerName, setCustomerName] = useState(() => editOrder?.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(() => editOrder?.customerPhone ?? "");
  const [customerAddress, setCustomerAddress] = useState(() => editOrder?.customerAddress ?? "");
  const [discountPercent, setDiscountPercent] = useState("");
  // The order stores one folded discount amount, so it seeds the flat "minus"
  // field (the % split can't be recovered) -- same limitation as the order
  // detail editor.
  const [minusAmount, setMinusAmount] = useState(() =>
    editOrder && editOrder.discount ? String(editOrder.discount) : ""
  );
  // Customer-requested delivery date & time as "YYYY-MM-DDTHH:MM"
  // (datetime-local). Blank = ASAP / same day.
  const [deliveryAt, setDeliveryAt] = useState(() =>
    editOrder?.deliveryAt ? isoToLocalMinute(editOrder.deliveryAt) : ""
  );
  const [deliveryFee, setDeliveryFee] = useState(() =>
    editOrder && editOrder.deliveryFee ? String(editOrder.deliveryFee) : ""
  );
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; phone: string } | null>(
    () =>
      editOrder?.customerId
        ? { id: editOrder.customerId, phone: editOrder.customerPhone }
        : null
  );
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [phoneDropdownOpen, setPhoneDropdownOpen] = useState(false);
  // The phone-suggestion list is position:fixed and anchored just above the
  // phone input, so the checkout panel's own `overflow-y-auto` scroll
  // container can't clip it.
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [phonePos, setPhonePos] = useState<{ bottom: number; left: number; width: number } | null>(
    null
  );
  const [receipt, setReceipt] = useState<ChargeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A brief, self-dismissing toast for "you tapped an out-of-stock product" --
  // separate from `error` (which stays until the user fixes a real problem,
  // e.g. a missing phone number) since this is just a heads-up, not something
  // blocking checkout.
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const [isCharging, startCharging] = useTransition();
  const [, startLookup] = useTransition();
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, []);

  useEffect(() => {
    if (!stockNotice) return;
    const t = setTimeout(() => setStockNotice(null), 3000);
    return () => clearTimeout(t);
  }, [stockNotice]);

  useEffect(() => {
    if (!phoneDropdownOpen) return;
    function place() {
      const r = phoneInputRef.current?.getBoundingClientRect();
      if (r) {
        setPhonePos({
          bottom: window.innerHeight - r.top + 6,
          left: r.left,
          width: Math.max(r.width, 240),
        });
      }
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [phoneDropdownOpen]);

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

  // Blocks adding a product once it's out of stock -- accounting for what's
  // already in the Order, so tapping past the last available unit is blocked
  // too, not just a product that started at 0.
  function handleProductCardClick(product: ProductWithStock) {
    const inCart = cart.find((l) => l.productId === product.id)?.quantity ?? 0;
    const remaining = product.stock_quantity - inCart;
    if (remaining <= 0) {
      setStockNotice(`${product.name} is out of stock`);
      return;
    }
    addToCart(product);
  }

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

  // The entry key for a website product/variation pair -- matches the one
  // SalesWebsiteGrid uses for its own cards (see toEntries there).
  function entryKeyFor(siteProductId: string, variationId: string | null): string {
    return variationId ? `${siteProductId}::${variationId}` : siteProductId;
  }

  // A website product is charged through the POS product it's linked to
  // (product_site_links) -- that's the id charge_order expects and the stock
  // row it decrements. Build the lookup from the catalog we already loaded,
  // plus anything linked on tap this session. Keyed by entry key so each size
  // of a "variable" product (same site_product_id, distinct variation_id)
  // gets its own POS product.
  const posByEntryKey = useMemo(() => {
    const map = new Map<string, ProductWithStock>();
    for (const p of products) {
      if (p.site_link) {
        const key = entryKeyFor(p.site_link.site_product_id, p.site_link.variation_id || null);
        map.set(key, p);
      }
    }
    for (const [key, p] of linkedThisSession) map.set(key, p);
    return map;
  }, [products, linkedThisSession]);

  // entry key -> quantity currently in the Order, for the grid's
  // remaining-stock display.
  const cartQtyByEntryKey = useMemo(() => {
    const posIdToEntryKey = new Map<string, string>();
    for (const [key, pos] of posByEntryKey) posIdToEntryKey.set(pos.id, key);
    const map = new Map<string, number>();
    for (const line of cart) {
      const key = posIdToEntryKey.get(line.productId);
      if (key) map.set(key, (map.get(key) ?? 0) + line.quantity);
    }
    return map;
  }, [cart, posByEntryKey]);

  // Tapping a website product (or one size of a "variable" one): if it
  // already maps to a POS product, add it; otherwise create + link one on the
  // fly (in the storefront's brand), then add. The created product shows up
  // in Stock like any hand-linked one. `variation` is null for a simple
  // product, or the specific size/flavor tapped for a variable one.
  async function addWebsiteProductToCart(wp: WebsiteProduct, variation: WebsiteProductVariation | null) {
    const entryKey = entryKeyFor(wp.id, variation?.id ?? null);
    const price = variation ? variation.price : wp.price;
    const salePrice = variation ? variation.sale_price : wp.sale_price;
    const stock = variation ? variation.stock : wp.stock;
    const imageUrl = variation?.image_url ?? wp.image_url;
    const title = variation?.weight ? `${wp.title} (${variation.weight})` : wp.title;

    // Same "remaining" the card itself shows (stock minus what's already in
    // the Order) -- blocks adding once it hits 0, including tapping past the
    // last unit of something that started in stock. `stock == null` (never
    // tracked) is never treated as out of stock.
    const inCart = cartQtyByEntryKey.get(entryKey) ?? 0;
    const remaining = stock == null ? null : stock - inCart;
    if (remaining != null && remaining <= 0) {
      setStockNotice(`${title} is out of stock`);
      return;
    }

    // The site's current sale price, if it's on sale -- charge what the card
    // actually shows, not the linked POS product's (possibly stale, always
    // full-price-at-link-time) stored price.
    const effectivePrice = salePrice != null && salePrice < price ? salePrice : price;
    const known = posByEntryKey.get(entryKey);
    if (known) {
      addToCart({ ...known, price: effectivePrice });
      return;
    }
    if (!websiteCatalog || linkingEntryKey) return;
    setLinkingEntryKey(entryKey);
    try {
      const linked = await ensurePosProductForSiteProduct({
        catalogId: websiteCatalog.id,
        siteProductId: wp.id,
        variationId: variation?.id ?? null,
        title,
        price: effectivePrice,
        imageUrl,
        stock,
      });
      const asProduct = {
        id: linked.id,
        name: linked.name,
        price: effectivePrice,
        unit: linked.unit,
      } as ProductWithStock;
      setLinkedThisSession((prev) => new Map(prev).set(entryKey, asProduct));
      addToCart(asProduct);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add this website product");
    } finally {
      setLinkingEntryKey(null);
    }
  }

  function renderProductCard(p: ProductWithStock) {
    const isOut = p.stock_quantity <= 0;
    const isLow = !isOut && p.low_stock_threshold > 0 && p.stock_quantity <= p.low_stock_threshold;
    return (
      <button
        key={p.id}
        onClick={() => handleProductCardClick(p)}
        className="flex flex-col items-start rounded-lg border border-black/[.08] p-4 text-left transition-colors hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
      >
        <div className="relative mb-2 aspect-square w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
          {p.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-300 dark:text-zinc-600">
              <UtensilsCrossed className="size-8" />
            </div>
          )}
          {isOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/55">
              <span className="rounded-full bg-zinc-800/90 px-2.5 py-1 text-xs font-bold text-white">
                Out of stock
              </span>
            </div>
          )}
        </div>
        <div className="line-clamp-2 min-h-12 leading-6 font-medium">{p.name}</div>
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
    if (cart.length === 0) {
      setError("Add at least one product");
      return;
    }

    if (editOrder) {
      startCharging(async () => {
        try {
          await updateOrderAction(editOrder.orderId, {
            customerName,
            customerPhone: phone,
            customerAddress: customerAddress.trim(),
            brandId: currentBrand.id,
            items: cart.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
            discountPercent: discountPercentValue,
            minusAmount: minusValue,
            deliveryFee: deliveryFeeValue,
            deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : "",
            note: note.trim(),
          });
          router.push(`/orders/${editOrder.orderId}`);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Couldn't update the order");
        }
      });
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
          deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
          note: note.trim() || undefined,
        });
        setReceipt(result);
        notifySaleCharged({
          orderId: result.orderId,
          amount: result.total,
          customerName: customerName.trim() || null,
          invoiceNumber: result.invoiceNumber,
        });
        setCart([]);
        setPaymentReference("");
        setNote("");
        setCustomerName("");
        setCustomerPhone("");
        setCustomerAddress("");
        setDiscountPercent("");
        setMinusAmount("");
        setDeliveryFee("");
        setDeliveryAt("");
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
      {stockNotice && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center"
        >
          <div className="rounded-full border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-lg dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {stockNotice}
          </div>
        </div>
      )}
      <header className="flex items-center gap-3 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <select
          className="rounded border border-black/[.15] bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-50 dark:border-white/[.2]"
          value={currentBrand.id}
          onChange={(e) => switchBrand(e.target.value)}
          disabled={!!editOrder}
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

      {editOrder && (
        <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>
            Editing order <span className="font-semibold">{editOrder.invoiceNumber}</span> — add
            products, then hit <span className="font-semibold">Update order</span>.
          </span>
          <Link
            href={`/orders/${editOrder.orderId}`}
            className="shrink-0 font-medium underline hover:no-underline"
          >
            Cancel
          </Link>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {showWebsite && websiteCatalog ? (
          <SalesWebsiteGrid
            key={websiteCatalog.id}
            catalogId={websiteCatalog.id}
            initialProducts={websiteCatalog.products}
            initialError={websiteCatalog.error}
            categories={websiteCatalog.categories}
            onSelect={addWebsiteProductToCart}
            pendingEntryKey={linkingEntryKey}
            cartQtyByEntryKey={cartQtyByEntryKey}
          />
        ) : (
        <main className="flex-1 overflow-y-auto p-6">
          {/* Category chips wrap onto a few rows -- no horizontal scrolling.
              Capped at ~3 rows with a toggle so a long list doesn't push the
              products down. */}
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
            {categories.length > 9 && (
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
          <div
            className={`min-h-[8rem] flex-1 overflow-y-auto px-4 py-3 ${
              cart.length === 0 ? "flex items-center justify-center" : ""
            }`}
          >
            {cart.length === 0 && (
              <div className="flex flex-col items-center gap-3 px-4 text-center">
                <div className="grid size-16 place-items-center rounded-full bg-muted text-muted-foreground">
                  <ShoppingCart className="size-7" />
                </div>
                <p className="text-sm font-medium text-foreground">Your order is empty</p>
                <p className="text-xs text-muted-foreground">
                  Tap a product on the left to add it here.
                </p>
              </div>
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

          <div className="flex max-h-[62%] shrink-0 flex-col border-t border-black/[.08] dark:border-white/[.145]">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {/* Customer */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                Customer
              </p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    ref={phoneInputRef}
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
                  {phoneDropdownOpen && customerPhone.trim().length > 0 && phonePos && (
                    <div
                      style={{
                        position: "fixed",
                        bottom: phonePos.bottom,
                        left: phonePos.left,
                        width: phonePos.width,
                        zIndex: 50,
                      }}
                      className="max-h-64 overflow-y-auto rounded-lg border border-black/[.15] bg-white shadow-xl dark:border-white/[.2] dark:bg-zinc-900"
                    >
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
                        <p className="px-3 py-2 text-xs text-zinc-500">
                          No matches — pick New to add them.
                        </p>
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
              {isExistingCustomer && (
                <p className="mt-1 text-xs text-green-600">
                  Existing customer — reusing their record.
                </p>
              )}
              {!isExistingCustomer && customerPhone.trim().length > 0 && (
                <p className="mt-1 text-xs text-amber-500">
                  New customer — will be added on charge.
                </p>
              )}
            </div>

            {/* Discounts & delivery */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                Discounts &amp; delivery
              </p>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                  Discount %
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="0"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                    className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                  Minus $
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    value={minusAmount}
                    onChange={(e) => setMinusAmount(e.target.value)}
                    className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
                  Delivery $
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(e.target.value)}
                    className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground dark:border-white/[.2]"
                  />
                </label>
              </div>

              {/* When the customer wants it, date + time -- blank = same day / ASAP. */}
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Deliver by</span>
                  <span className="text-zinc-500">blank = same day</span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="datetime-local"
                    min={nowLocalMinute()}
                    value={deliveryAt}
                    onChange={(e) => setDeliveryAt(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground [color-scheme:light] dark:border-white/[.2] dark:[color-scheme:dark]"
                  />
                  {deliveryAt && (
                    <button
                      type="button"
                      onClick={() => setDeliveryAt("")}
                      className="rounded border border-black/[.15] px-2 text-xs text-zinc-500 dark:border-white/[.2]"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["Today", 0],
                      ["Tomorrow", 1],
                      ["In 2 days", 2],
                    ] as const
                  ).map(([label, n]) => {
                    // Keep whatever time is already picked; default to 12:00.
                    const time = deliveryAt.includes("T") ? deliveryAt.slice(11, 16) : "12:00";
                    const target = `${dateOffset(n)}T${time}`;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setDeliveryAt(target)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          deliveryAt.slice(0, 10) === dateOffset(n)
                            ? "border-brand bg-brand text-black"
                            : "border-black/[.15] dark:border-white/[.2]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Payment */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                Payment
              </p>
              <div className="flex gap-2">
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
            </div>

            {/* Note / description -- free text, printed under Remarks on the
                invoice. */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                Description
              </p>
              <textarea
                rows={2}
                placeholder="Note for this order (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full resize-y rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
              />
            </div>
            </div>

            {/* Summary + total + Charge -- always pinned at the bottom of the
                panel so the amount due and the button never scroll away. */}
            <div className="shrink-0 space-y-2.5 border-t border-black/[.08] px-4 py-3 dark:border-white/[.145]">
            <div className="rounded-lg bg-black/[.03] px-3 py-2.5 dark:bg-white/[.04]">
              <div className="flex justify-between text-sm text-zinc-500">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-zinc-500">
                  <span>Discount</span>
                  <span className="tabular-nums">-{formatMoney(discountAmount)}</span>
                </div>
              )}
              {deliveryFeeValue > 0 && (
                <div className="flex justify-between text-sm text-zinc-500">
                  <span>Delivery</span>
                  <span className="tabular-nums">{formatMoney(deliveryFeeValue)}</span>
                </div>
              )}
              <div className="mt-1.5 flex items-baseline justify-between border-t border-black/[.08] pt-1.5 dark:border-white/[.145]">
                <span className="text-sm font-medium">Total</span>
                <span className="text-2xl font-bold tabular-nums">{formatMoney(finalTotal)}</span>
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              disabled={cart.length === 0 || isCharging || !customerPhone.trim()}
              onClick={handleCharge}
              className="w-full rounded-full bg-green-600 py-3 text-base font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-40"
            >
              {editOrder
                ? isCharging
                  ? "Updating…"
                  : `Update order · ${formatMoney(finalTotal)}`
                : isCharging
                  ? "Charging…"
                  : `Charge ${formatMoney(finalTotal)}`}
            </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
