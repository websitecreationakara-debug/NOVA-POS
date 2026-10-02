"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Banknote,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Plus,
  QrCode,
  ShoppingCart,
  Smartphone,
  User,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import type { Brand, Category } from "@/types/database";
import { CHECKOUT_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/paymentMethods";
import { CHECKOUT_ORDER_SOURCES, ORDER_SOURCE_LABELS, type OrderSource } from "@/lib/orderSource";

// No real brand-logo assets to license/embed for ABA Pay/Wing/KHQR/Visa --
// a generic-but-distinct icon per method still speeds up recognition at
// checkout without pretending to be an official logo.
const PAYMENT_METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  aba_pay: Smartphone,
  wing: Wallet,
  khqr: QrCode,
  card: CreditCard,
  bank_qr: QrCode,
};
import type { ProductWithStock } from "@/lib/supabase/queries";
import type { WebsiteProduct, WebsiteProductVariation } from "@/lib/websiteProducts/types";
import SalesWebsiteGrid from "./SalesWebsiteGrid";
import TopBarSlot from "@/components/TopBarSlot";
import type { SalesWebsiteCatalog } from "./page";
import {
  chargeOrder,
  searchCustomersByName,
  searchCustomersByPhone,
  type CartLine,
  type ChargeResult,
  type CustomerSuggestion,
} from "./actions";
import { updateOrderAction } from "@/app/(app)/orders/actions";
import { ensurePosProductForSiteProduct, syncPosProductName } from "./websiteActions";
import { notifySaleCharged } from "@/lib/saleCharged";
import { notifyOrdersChanged } from "@/lib/ordersChanged";
import { parseGrams, sizedLine } from "@/lib/weight";
import { COUNTRY_PREFIX, toFullPhone } from "@/lib/phone";

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
  paymentMethod: PaymentMethod | null;
  // Requested delivery as an ISO timestamp, or "" for none.
  deliveryAt: string;
  note: string;
  orderSource: OrderSource;
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

// The delivery value is "YYYY-MM-DDTHH:MM", or just "YYYY-MM-DD" while no time
// has been picked. Orders need a time, so a date with no time is saved as noon.
function withDeliveryTime(v: string): string {
  return v && !v.includes("T") ? `${v}T12:00` : v;
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(editOrder?.paymentMethod ?? "khqr");
  const [orderSource, setOrderSource] = useState<OrderSource>(editOrder?.orderSource ?? "telegram");
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
  const phoneInputRef = useRef<HTMLDivElement>(null);
  // The order panel, so the phone/tablet "View order" button can jump to it.
  const orderPanelRef = useRef<HTMLElement>(null);
  const [phonePos, setPhonePos] = useState<{ bottom: number; left: number; width: number } | null>(
    null
  );
  // Same lookup, keyed off the name field instead -- for staff who only
  // remember the customer's name, not their number.
  const [nameSuggestions, setNameSuggestions] = useState<CustomerSuggestion[]>([]);
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Website products whose POS name has already been synced to the website
  // title this session, so repeat taps don't repeat the write.
  const renamedEntryKeys = useRef<Set<string>>(new Set());
  const [namePos, setNamePos] = useState<{ bottom: number; left: number; width: number } | null>(
    null
  );
  const nameSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // The order being built lives in this component's state, which is thrown away
  // when staff open another page -- so keep a draft in this tab's
  // sessionStorage (per business) and put it back on return. Not used when
  // editing an existing order, which is seeded from the server instead. The
  // draft is cleared by the same reset a successful charge already does.
  const draftKey = `nova:sales-draft:${currentBrand.id}`;
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    if (!editOrder) {
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (raw) {
          const d = JSON.parse(raw) as Partial<{
            cart: CartLine[];
            paymentMethod: PaymentMethod;
            orderSource: OrderSource;
            paymentReference: string;
            note: string;
            customerName: string;
            customerPhone: string;
            customerAddress: string;
            discountPercent: string;
            minusAmount: string;
            deliveryAt: string;
            deliveryFee: string;
            selectedCustomer: { id: string; phone: string } | null;
          }>;
          /* eslint-disable react-hooks/set-state-in-effect -- restoring the saved draft after mount: reading storage during render would make the browser's first render differ from the server HTML */
          if (Array.isArray(d.cart)) setCart(d.cart);
          if (d.paymentMethod) setPaymentMethod(d.paymentMethod);
          if (d.orderSource) setOrderSource(d.orderSource);
          if (typeof d.paymentReference === "string") setPaymentReference(d.paymentReference);
          if (typeof d.note === "string") setNote(d.note);
          if (typeof d.customerName === "string") setCustomerName(d.customerName);
          if (typeof d.customerPhone === "string") setCustomerPhone(d.customerPhone);
          if (typeof d.customerAddress === "string") setCustomerAddress(d.customerAddress);
          if (typeof d.discountPercent === "string") setDiscountPercent(d.discountPercent);
          if (typeof d.minusAmount === "string") setMinusAmount(d.minusAmount);
          if (typeof d.deliveryAt === "string") setDeliveryAt(d.deliveryAt);
          if (typeof d.deliveryFee === "string") setDeliveryFee(d.deliveryFee);
          if (d.selectedCustomer) setSelectedCustomer(d.selectedCustomer);
          /* eslint-enable react-hooks/set-state-in-effect */
        }
      } catch {
        // storage blocked or a bad draft -- start with an empty order
      }
    }
    setDraftLoaded(true);
    // Mount only: restores once, before anything is saved over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draftLoaded || editOrder) return;
    try {
      const empty =
        cart.length === 0 && !customerName && !customerPhone && !customerAddress && !note;
      if (empty) {
        sessionStorage.removeItem(draftKey);
      } else {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({
            cart,
            paymentMethod,
            orderSource,
            paymentReference,
            note,
            customerName,
            customerPhone,
            customerAddress,
            discountPercent,
            minusAmount,
            deliveryAt,
            deliveryFee,
            selectedCustomer,
          })
        );
      }
    } catch {
      // storage full or blocked -- the order just won't survive leaving the page
    }
  }, [
    draftLoaded,
    editOrder,
    draftKey,
    cart,
    paymentMethod,
    orderSource,
    paymentReference,
    note,
    customerName,
    customerPhone,
    customerAddress,
    discountPercent,
    minusAmount,
    deliveryAt,
    deliveryFee,
    selectedCustomer,
  ]);

  useEffect(() => {
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      if (nameSearchDebounce.current) clearTimeout(nameSearchDebounce.current);
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

  useEffect(() => {
    if (!nameDropdownOpen) return;
    function place() {
      const r = nameInputRef.current?.getBoundingClientRect();
      if (r) {
        setNamePos({
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
  }, [nameDropdownOpen]);

  const isExistingCustomer = selectedCustomer?.phone === customerPhone.trim() && !!selectedCustomer;

  const q = search.trim().normalize("NFC").toLowerCase();
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
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.name_km ?? "").normalize("NFC").toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q)
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

  function addToCart(product: ProductWithStock, weightLabel: string | null = null) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          nameKm: product.name_km ?? null,
          unit: product.unit,
          unitKm: product.unit_km ?? null,
          weightLabel,
          unitPrice: product.price,
          quantity: 1,
        },
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

  // website product id -> Khmer name(s) of its linked POS products, so the
  // website grid's search can match Khmer as well as the English title.
  const khmerNamesBySiteProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      if (!p.site_link || !p.name_km) continue;
      const id = p.site_link.site_product_id;
      map.set(id, `${map.get(id) ?? ""} ${p.name_km}`.trim());
    }
    return map;
  }, [products]);

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
    // A simple product's weight isn't part of its title (a variation's is), so
    // carry it along to show in the cart.
    const weightLabel = variation ? null : wp.weight?.trim() || null;

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
      // The website title is the source of truth for the name: if the product
      // was renamed there, bring the POS product's name along (once per tap
      // session) and show the new name in the cart straight away.
      if (known.name !== title && !renamedEntryKeys.current.has(entryKey)) {
        renamedEntryKeys.current.add(entryKey);
        syncPosProductName(known.id, title).catch(() => renamedEntryKeys.current.delete(entryKey));
      }
      addToCart({ ...known, name: title, price: effectivePrice }, weightLabel);
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
      addToCart(asProduct, weightLabel);
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

  function setUnitPrice(productId: string, unitPrice: number) {
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, unitPrice } : l)));
  }

  // What the cart / receipt show for a line: the Khmer name when the product
  // has one, otherwise the English name.
  function lineName(line: CartLine): string {
    return line.nameKm?.trim() || line.name;
  }

  // The line's scale in Khmer when it has one, else the plain unit (pcs/kg/g).
  function lineScale(line: CartLine): string | null {
    return line.unitKm?.trim() || line.unit?.trim() || null;
  }

  // Weight of one full unit of the line's product, if known: the product's own
  // recorded weight, else read from its name ("... (350g)", "... 1kg").
  function packGramsFor(line: CartLine): number | null {
    const w = products.find((p) => p.id === line.productId)?.weight_grams;
    return w && w > 0 ? w : parseGrams(line.name);
  }

  // The full-size price in effect for a line, so a size can be changed again
  // without compounding: remembered when the size was first set, or worked
  // back from a saved custom-size line (edit mode).
  function fullPriceFor(line: CartLine, packGrams: number): number {
    if (line.listPrice !== undefined) return line.listPrice;
    const soldGrams = line.sizeLabel ? parseGrams(line.sizeLabel) : null;
    if (soldGrams) return (line.unitPrice * line.quantity * packGrams) / soldGrams;
    return line.unitPrice;
  }

  // Sell part of a pack (100g of a 350g steak): the quantity becomes the
  // fraction sold -- so stock goes down by the weight actually sold -- and the
  // price scales to match (still editable). Full size / cleared goes back to 1.
  function setLineSize(line: CartLine, packGrams: number, soldGrams: number | null) {
    const fullPrice = fullPriceFor(line, packGrams);
    setCart((prev) =>
      prev.map((l) => {
        if (l.productId !== line.productId) return l;
        if (soldGrams === null || soldGrams === packGrams) {
          return { ...l, quantity: 1, unitPrice: fullPrice, sizeLabel: null, listPrice: undefined };
        }
        const sized = sizedLine(packGrams, soldGrams, fullPrice);
        if (!sized) return l;
        return {
          ...l,
          quantity: sized.quantity,
          unitPrice: sized.unitPrice,
          sizeLabel: sized.label,
          listPrice: fullPrice,
        };
      })
    );
  }

  // For a custom-size line the price box is the price of the whole line (what
  // the customer pays for that size); the per-unit price is worked back from it.
  function setLinePrice(line: CartLine, linePrice: number) {
    setCart((prev) =>
      prev.map((l) =>
        l.productId === line.productId
          ? { ...l, unitPrice: Math.round((linePrice / l.quantity) * 100) / 100 }
          : l
      )
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
    if (trimmed.length < 1) {
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

  function handleNameChange(value: string) {
    setCustomerName(value);
    setSelectedCustomer(null);
    setNameDropdownOpen(true);

    if (nameSearchDebounce.current) clearTimeout(nameSearchDebounce.current);
    const trimmed = value.trim();
    if (trimmed.length < 1) {
      setNameSuggestions([]);
      return;
    }
    nameSearchDebounce.current = setTimeout(() => {
      startLookup(async () => {
        try {
          setNameSuggestions(await searchCustomersByName(trimmed));
        } catch {
          setNameSuggestions([]);
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
    setNameDropdownOpen(false);
  }

  function selectNewCustomer() {
    setSelectedCustomer(null);
    setPhoneDropdownOpen(false);
    setNameDropdownOpen(false);
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
              sizeLabel: l.sizeLabel,
            })),
            discountPercent: discountPercentValue,
            minusAmount: minusValue,
            deliveryFee: deliveryFeeValue,
            deliveryAt: deliveryAt ? new Date(withDeliveryTime(deliveryAt)).toISOString() : "",
            note: note.trim(),
            paymentMethod,
            orderSource,
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
          deliveryAt: deliveryAt ? new Date(withDeliveryTime(deliveryAt)).toISOString() : undefined,
          note: note.trim() || undefined,
          orderSource,
        });
        setReceipt(result);
        notifyOrdersChanged(); // refresh the sidebar's Orders badge right away
        notifySaleCharged({
          orderId: result.orderId,
          amount: result.total,
          customerName: customerName.trim() || null,
          invoiceNumber: result.invoiceNumber,
        });
        setCart([]);
        setPaymentReference("");
        setNote("");
        setOrderSource("telegram");
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
                {l.quantity} × {lineName(l)}
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
      {/* Phones/tablets stack the order panel under the products, so give the
          cashier a way to reach it without scrolling the whole grid. */}
      {cart.length > 0 && (
        <button
          type="button"
          onClick={() => orderPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg lg:hidden"
        >
          <ShoppingCart className="size-4" />
          View order · {formatMoney(finalTotal)}
        </button>
      )}
      {/* Portaled into the shared TopBar's left side (see TopBarSlot) instead
          of its own row below it -- Sales' product grid benefits the most of
          any page from that extra row of vertical space. */}
      <TopBarSlot>
        <select
          className="min-w-0 max-w-[9.5rem] rounded border border-black/[.15] bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-50 sm:max-w-none dark:border-white/[.2]"
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
        <h1 className="hidden text-sm font-semibold text-foreground sm:block">Sales</h1>
        {!showWebsite && (
          <input
            type="text"
            placeholder="Search name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm sm:ml-auto sm:w-64 sm:flex-none dark:border-white/[.2]"
          />
        )}
      </TopBarSlot>

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

      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
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
            khmerNames={khmerNamesBySiteProduct}
          />
        ) : (
        <main className="flex-none p-3 sm:p-6 lg:flex-1 lg:overflow-y-auto">
          {/* Category chips wrap onto a few rows -- no horizontal scrolling.
              Capped at ~3 rows with a toggle so a long list doesn't push the
              products down. */}
          <div className="mb-4">
            <div
              className="flex flex-wrap gap-1.5"
              style={categoriesExpanded ? undefined : { maxHeight: "7.5rem", overflow: "hidden" }}
            >
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

        <aside ref={orderPanelRef} className="flex w-full shrink-0 flex-col border-t border-black/[.08] lg:w-[34rem] lg:border-t-0 lg:border-l dark:border-white/[.145]">
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
            {cart.map((line) => {
              const packGrams = packGramsFor(line);
              const sized = !!line.sizeLabel;
              return (
              <div key={line.productId} className="flex items-center justify-between py-2 text-sm">
                <div className="flex-1">
                  <div>
                    {lineName(line)}
                    {line.weightLabel && !packGrams && (
                      <span className="ml-1.5 text-xs text-zinc-400">{line.weightLabel}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-zinc-500">
                    <UnitPriceInput
                      value={sized ? line.quantity * line.unitPrice : line.unitPrice}
                      onChange={(price) =>
                        sized ? setLinePrice(line, price) : setUnitPrice(line.productId, price)
                      }
                    />
                    <span>
                      {sized ? "for this size" : lineScale(line) ? `/ ${lineScale(line)}` : "each"}
                    </span>
                  </div>
                  {packGrams && (
                    <SoldGramsInput
                      packGrams={packGrams}
                      soldGrams={(line.sizeLabel && parseGrams(line.sizeLabel)) || packGrams}
                      onChange={(g) => setLineSize(line, packGrams, g)}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!sized && (
                    <button
                      className="h-6 w-6 rounded border border-black/[.15] dark:border-white/[.2]"
                      onClick={() => updateQuantity(line.productId, -1)}
                    >
                      −
                    </button>
                  )}
                  <span className="min-w-4 text-center">{line.quantity}</span>
                  {!sized && (
                    <button
                      className="h-6 w-6 rounded border border-black/[.15] dark:border-white/[.2]"
                      onClick={() => updateQuantity(line.productId, 1)}
                    >
                      +
                    </button>
                  )}
                  <button
                    className="ml-1 text-zinc-400 hover:text-red-500"
                    onClick={() => removeLine(line.productId)}
                  >
                    ×
                  </button>
                </div>
              </div>
              );
            })}
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
                  {/* "855" is fixed in front: staff type the rest and the full number
                      (855 + digits) is what gets searched and saved. A saved number
                      that doesn't start with 855 is shown whole, without the prefix. */}
                  <div
                    ref={phoneInputRef}
                    className="flex w-full items-center rounded border border-black/[.15] focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50"
                  >
                    {(customerPhone === "" || customerPhone.startsWith(COUNTRY_PREFIX)) && (
                      <span className="border-r border-black/[.15] px-2.5 py-1.5 text-sm text-zinc-500 select-none dark:border-white/[.2]">
                        {COUNTRY_PREFIX}
                      </span>
                    )}
                    <input
                      type="tel"
                      required
                      autoComplete="off"
                      className="w-full min-w-0 bg-transparent px-3 py-1.5 text-sm outline-none"
                      placeholder="Phone number *"
                      value={
                        customerPhone.startsWith(COUNTRY_PREFIX)
                          ? customerPhone.slice(COUNTRY_PREFIX.length)
                          : customerPhone
                      }
                      onChange={(e) => handlePhoneChange(toFullPhone(e.target.value))}
                      onFocus={() => setPhoneDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setPhoneDropdownOpen(false), 150)}
                    />
                  </div>
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
                      {suggestions.length === 0 && customerPhone.trim().length >= 1 && (
                        <p className="px-3 py-2 text-xs text-zinc-500">
                          No matches — pick New to add them.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <input
                    ref={nameInputRef}
                    autoComplete="off"
                    className="w-full rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
                    placeholder={isExistingCustomer ? "Customer name" : "Customer name *"}
                    value={customerName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    onFocus={() => setNameDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setNameDropdownOpen(false), 150)}
                  />
                  {nameDropdownOpen && customerName.trim().length > 0 && nameSuggestions.length > 0 && namePos && (
                    <div
                      style={{
                        position: "fixed",
                        bottom: namePos.bottom,
                        left: namePos.left,
                        width: namePos.width,
                        zIndex: 50,
                      }}
                      className="max-h-64 overflow-y-auto rounded-lg border border-black/[.15] bg-white shadow-xl dark:border-white/[.2] dark:bg-zinc-900"
                    >
                      {nameSuggestions.map((c) => (
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
                            <span>{c.name}</span>
                            <span className="text-xs text-zinc-500">{c.phone}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
                  {/* Just a date to start with; the time box appears once a date is
                      picked. The value stays one "YYYY-MM-DDTHH:MM" string. */}
                  <input
                    type="date"
                    min={dateOffset(0)}
                    value={deliveryAt.slice(0, 10)}
                    onChange={(e) =>
                      setDeliveryAt(
                        e.target.value
                          ? deliveryAt.includes("T")
                            ? `${e.target.value}T${deliveryAt.slice(11, 16)}`
                            : e.target.value
                          : ""
                      )
                    }
                    className="min-w-0 flex-1 rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground [color-scheme:light] dark:border-white/[.2] dark:[color-scheme:dark]"
                  />
                  {deliveryAt && (
                    <input
                      type="time"
                      aria-label="Delivery time"
                      min={deliveryAt.slice(0, 10) === dateOffset(0) ? nowLocalMinute().slice(11, 16) : undefined}
                      value={deliveryAt.slice(11, 16)}
                      onChange={(e) =>
                        setDeliveryAt(
                          e.target.value
                            ? `${deliveryAt.slice(0, 10)}T${e.target.value}`
                            : deliveryAt.slice(0, 10)
                        )
                      }
                      className="w-32 shrink-0 rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm text-foreground [color-scheme:light] dark:border-white/[.2] dark:[color-scheme:dark]"
                    />
                  )}
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
                    // Keep whatever time is already picked; otherwise leave it blank.
                    const target = deliveryAt.includes("T")
                      ? `${dateOffset(n)}T${deliveryAt.slice(11, 16)}`
                      : dateOffset(n);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setDeliveryAt(target)}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          deliveryAt.slice(0, 10) === dateOffset(n)
                            ? "border-brand bg-brand text-white"
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

            {/* Order via (កម្មង់តាម) */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                Order via
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {CHECKOUT_ORDER_SOURCES.map((src) => {
                  const active = orderSource === src;
                  return (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setOrderSource(active ? "in_store" : src)}
                      aria-pressed={active}
                      className={`rounded-lg border py-1.5 text-[11px] leading-tight font-medium transition-colors ${
                        active
                          ? "border-brand bg-brand text-white"
                          : "border-black/[.15] hover:border-black/[.3] dark:border-white/[.2] dark:hover:border-white/[.35]"
                      }`}
                    >
                      {ORDER_SOURCE_LABELS[src]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
                Payment
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {CHECKOUT_PAYMENT_METHODS.map((pm) => {
                  const Icon = PAYMENT_METHOD_ICONS[pm];
                  const active = paymentMethod === pm;
                  return (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setPaymentMethod(pm)}
                      aria-pressed={active}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border py-1.5 text-[11px] leading-tight font-medium transition-colors ${
                        active
                          ? "border-brand bg-brand text-white"
                          : "border-black/[.15] hover:border-black/[.3] dark:border-white/[.2] dark:hover:border-white/[.35]"
                      }`}
                    >
                      <Icon className="size-3.5" />
                      {PAYMENT_METHOD_LABELS[pm]}
                    </button>
                  );
                })}
              </div>
              {paymentMethod !== "cash" && (
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

// The cart's per-unit price, editable so staff can charge something other than
// the listed price. Keeps its own text while typing ("8." / "" are valid
// mid-edit) and only pushes parseable, non-negative numbers up.
function UnitPriceInput({ value, onChange }: { value: number; onChange: (price: number) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  return (
    <label className="flex items-center">
      $
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        aria-label="Price each"
        value={focused ? text : value.toFixed(2)}
        onFocus={(e) => {
          setText(value.toFixed(2));
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
        onBlur={() => setFocused(false)}
        className="ml-0.5 w-20 rounded border border-black/[.15] bg-transparent px-1 py-0.5 text-sm text-foreground tabular-nums dark:border-white/[.2]"
      />
    </label>
  );
}

// "Sold: [100] g" on a cart line -- how much of the pack the customer is
// actually buying. Pushes up a valid, positive weight as it's typed; full pack
// weight (the default) means a normal full-size line.
function SoldGramsInput({
  packGrams,
  soldGrams,
  onChange,
}: {
  packGrams: number;
  soldGrams: number;
  onChange: (grams: number | null) => void;
}) {
  const [text, setText] = useState(String(soldGrams));
  const [focused, setFocused] = useState(false);
  return (
    <label className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
      Sold
      <input
        type="number"
        inputMode="decimal"
        min={1}
        step="any"
        aria-label="Grams sold"
        value={focused ? text : String(soldGrams)}
        onFocus={(e) => {
          setText(String(soldGrams));
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n > 0) onChange(n);
        }}
        onBlur={() => setFocused(false)}
        className="w-20 rounded border border-black/[.15] bg-transparent px-1 py-0.5 text-sm text-foreground tabular-nums dark:border-white/[.2]"
      />
      g
      {soldGrams !== packGrams && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-1 text-zinc-400 underline hover:text-foreground"
        >
          reset to {packGrams}g
        </button>
      )}
    </label>
  );
}
