"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, User } from "lucide-react";
import type { Brand, Category, PaymentMethod } from "@/types/database";
import type { ProductWithStock } from "@/lib/supabase/queries";
import {
  chargeOrder,
  searchCustomersByPhone,
  type CartLine,
  type ChargeResult,
  type CustomerSuggestion,
} from "./actions";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function SalesClient({
  brands,
  currentBrand,
  categories,
  products,
  initialSearch,
}: {
  brands: Brand[];
  currentBrand: Brand;
  categories: Category[];
  products: ProductWithStock[];
  initialSearch: string;
}) {
  const router = useRouter();
  const [activeCategoryId, setActiveCategoryId] = useState<string | "all">("all");
  const [search, setSearch] = useState(initialSearch);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
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

  const visibleProducts = useMemo(() => {
    let list =
      activeCategoryId === "all"
        ? products
        : products.filter((p) => p.category_id === activeCategoryId);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeCategoryId, search]);

  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

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
        });
        setReceipt(result);
        setCart([]);
        setPaymentReference("");
        setCustomerName("");
        setCustomerPhone("");
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
          className="rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
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
        <input
          type="text"
          placeholder="Search name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto w-64 rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]"
        />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
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

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visibleProducts.map((p) => {
              const isOut = p.stock_quantity <= 0;
              const isLow =
                !isOut && p.low_stock_threshold > 0 && p.stock_quantity <= p.low_stock_threshold;
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="flex flex-col items-start rounded-lg border border-black/[.08] p-4 text-left transition-colors hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-1 text-sm text-zinc-500">
                    {formatMoney(p.price)} / {p.unit}
                  </div>
                  <div
                    className={`mt-1 text-xs ${
                      isOut ? "text-red-500" : isLow ? "text-amber-500" : "text-zinc-400"
                    }`}
                  >
                    {isOut
                      ? "Out of stock"
                      : isLow
                        ? `Low stock — ${p.stock_quantity} left`
                        : `${p.stock_quantity} in stock`}
                  </div>
                </button>
              );
            })}
            {visibleProducts.length === 0 && (
              <p className="col-span-full text-sm text-zinc-500">No products in this category.</p>
            )}
          </div>
        </main>

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
            <div className="mt-1 flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>{formatMoney(subtotal)}</span>
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
              {isCharging ? "Charging…" : `Charge ${formatMoney(subtotal)}`}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
