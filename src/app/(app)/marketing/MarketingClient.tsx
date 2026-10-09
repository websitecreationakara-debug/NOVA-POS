"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { Brand, Customer, DiscountType, Promotion } from "@/types/database";
import { CUSTOMER_GENDERS, CUSTOMER_NATIONALITIES, PROVINCES } from "@/lib/cambodiaPlaces";
import CustomerPurchasesDialog from "@/components/CustomerPurchasesDialog";
import DeleteCustomerDialog from "@/components/DeleteCustomerDialog";
import ImportCustomersButton from "@/components/ImportCustomersButton";
import {
  CUSTOMER_SORT_LABELS,
  NO_CUSTOMER_FILTERS,
  type CustomerBuying,
  type CustomerFilters,
  type CustomerSort,
} from "@/lib/customerFilters";
import {
  createPromotionAction,
  deletePromotionAction,
  setPromotionActiveAction,
  updateCustomerAction,
} from "./actions";
import { formatUsd } from "@/lib/formatNumber";

function formatDiscount(p: Promotion) {
  return p.discount_type === "percent" ? `${p.discount_value}%` : formatUsd(p.discount_value);
}

function formatWindow(p: Promotion) {
  if (!p.starts_at && !p.ends_at) return "Always on";
  const start = p.starts_at ? p.starts_at.slice(0, 10) : "…";
  const end = p.ends_at ? p.ends_at.slice(0, 10) : "…";
  return `${start} → ${end}`;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

// A dropdown for the customer edit form. The first entry is the empty choice
// (shown as the field name). A value already saved on the customer that isn't
// in the list (an older spelling, say) is kept as its own entry rather than
// silently dropped when the form opens.
function OptionSelect({
  value,
  onChange,
  placeholder,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  className: string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <select
      aria-label={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${className} ${value ? "" : "text-zinc-400"}`}
    >
      <option value="">{placeholder}</option>
      {value && !known && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} className="text-foreground">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function MarketingClient({
  brands,
  currentBrandId,
  promotions,
  customers,
  customerTotal,
  customerPage,
  customerLimit,
  customerBuying,
  customerBusinesses,
  customerFilters,
  filterOptions,
  today,
  crmOnly,
  openCustomerId,
  searchTerm,
}: {
  brands: Brand[];
  currentBrandId: string;
  promotions: Promotion[];
  customers: Customer[];
  customerTotal: number;
  customerPage: number;
  customerLimit: number;
  // What each listed customer bought, by customer id (counted orders only).
  customerBuying: Record<string, CustomerBuying>;
  // The businesses each listed customer has bought from, most-used first.
  customerBusinesses: Record<string, string[]>;
  customerFilters: CustomerFilters;
  filterOptions: {
    states: { value: string; n: number }[];
    ages: { value: string; n: number }[];
    genders: { value: string; n: number }[];
  };
  // Today in Phnom Penh (YYYY-MM-DD), for the "Bought on" quick buttons.
  today: string;
  // Sale Customer Support sees the customer list only -- no promotions, no
  // import, no delete.
  crmOnly: boolean;
  // The customer whose purchase-history window is open (?customer=), if any.
  openCustomerId: string;
  searchTerm: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Promotion create form
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [promoBrandId, setPromoBrandId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  // Customer search + inline edit
  const [search, setSearch] = useState(searchTerm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  // The purchase-history window. Its customer is kept in the page address
  // (?customer=<id>) so that coming BACK from an invoice opened inside it lands
  // on the same window, not just the list behind it. Opened on load if the
  // address names a customer on this page.
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(
    () => customers.find((c) => c.id === openCustomerId) ?? null
  );
  function setViewing(customer: Customer | null) {
    setViewingCustomer(customer);
    const url = new URL(window.location.href);
    if (customer) url.searchParams.set("customer", customer.id);
    else url.searchParams.delete("customer");
    window.history.replaceState(window.history.state, "", url);
  }

  // Dynamic (type-as-you-go) filter over the current page of rows the server
  // already sent -- instant, no round trip while typing. The server only
  // sends one page (?page=&limit=) of the (20k+) customers, so once typing
  // pauses the term is also applied to the URL (?q=), which re-queries the
  // server (back on page 1) so a customer on another page shows up too.
  useEffect(() => {
    const term = search.trim();
    if (term === searchTerm.trim()) return;
    const id = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (term) params.set("q", term);
      else params.delete("q");
      params.delete("page");
      router.replace(`/marketing?${params.toString()}`, { scroll: false });
    }, 350);
    return () => clearTimeout(id);
  }, [search, searchTerm, router]);

  const searchLower = search.trim().toLowerCase();
  const visibleCustomers = searchLower
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(searchLower) ||
          (c.phone ?? "").toLowerCase().includes(searchLower)
      )
    : customers;

  // Customer list pagination is server-side (?page=&limit=); changing the page
  // size keeps the current page number (see the "Items per page" select).
  const customerPageCount = Math.max(1, Math.ceil(customerTotal / customerLimit));

  // Show the effective page + limit in the address from the first visit (not
  // only after clicking Next), so a reload or shared link lands on the same view.
  // No refetch, no history entry.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("page") === String(customerPage) && params.get("limit") === String(customerLimit)) return;
    params.set("page", String(customerPage));
    params.set("limit", String(customerLimit));
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }, [customerPage, customerLimit]);

  function goToCustomerPage(page: number, limit = customerLimit) {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(page));
    params.set("limit", String(limit));
    router.push(`/marketing?${params.toString()}`, { scroll: false });
  }

  // The from/to "Bought on" boxes stay folded away behind the "Range" button
  // unless the page was opened on a custom range (not a single day / one of the
  // quick buttons) -- then they're needed to show it.
  const [showBoughtRange, setShowBoughtRange] = useState(
    () =>
      Boolean(customerFilters.boughtFrom || customerFilters.boughtTo) &&
      customerFilters.boughtFrom !== customerFilters.boughtTo
  );

  // The CRM filters live in the URL; changing one drops back to page 1.
  const filtersActive = JSON.stringify(customerFilters) !== JSON.stringify(NO_CUSTOMER_FILTERS);
  function setCustomerFilter(patch: Partial<Record<string, string>>) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    router.push(`/marketing?${params.toString()}`, { scroll: false });
  }
  function clearCustomerFilters() {
    setCustomerFilter({
      sort: "",
      state: "",
      gender: "",
      age: "",
      since_from: "",
      since_to: "",
      bought_from: "",
      bought_to: "",
    });
  }
  // Quick "Bought on" choices, in Phnom Penh days (YYYY-MM-DD).
  // `today` comes from the server (Phnom Penh day, YYYY-MM-DD).
  const daysAgo = (n: number) => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  const boughtPresets = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: daysAgo(1), to: daysAgo(1) },
    { label: "Last 7 days", from: daysAgo(6), to: today },
    { label: "This month", from: `${today.slice(0, 8)}01`, to: today },
  ];
  // "10/03/2026" from a YYYY-MM-DD filter value.
  const usDay = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  // One date on its own is open ended ("since" / "up to"); the same date in both
  // boxes is that single day.
  const boughtLabel = customerFilters.boughtFrom
    ? customerFilters.boughtTo
      ? customerFilters.boughtTo === customerFilters.boughtFrom
        ? `on ${usDay(customerFilters.boughtFrom)}`
        : `between ${usDay(customerFilters.boughtFrom)} and ${usDay(customerFilters.boughtTo)}`
      : `since ${usDay(customerFilters.boughtFrom)}`
    : customerFilters.boughtTo
      ? `up to ${usDay(customerFilters.boughtTo)}`
      : null;

  function withBrandParam(brandId: string) {
    const params = new URLSearchParams();
    if (brandId) params.set("brand", brandId);
    if (searchTerm) params.set("q", searchTerm);
    router.push(`/marketing?${params.toString()}`);
  }


  function createPromotion() {
    const value = parseFloat(discountValue);
    if (!code.trim() || Number.isNaN(value) || value < 0) {
      setError("Enter a code and a positive discount value");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createPromotionAction({
          code,
          description,
          discountType,
          discountValue: value,
          brandId: promoBrandId,
          startsAt,
          endsAt,
        });
        setCode("");
        setDescription("");
        setDiscountValue("");
        setStartsAt("");
        setEndsAt("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create promotion");
      }
    });
  }

  function toggleActive(promo: Promotion) {
    startTransition(async () => {
      try {
        await setPromotionActiveAction(promo.id, !promo.is_active);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update promotion");
      }
    });
  }

  function removePromotion(id: string) {
    if (!window.confirm("Delete this promotion code? This can't be undone.")) return;
    startTransition(async () => {
      try {
        await deletePromotionAction(id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete promotion");
      }
    });
  }

  function startEdit(customer: Customer) {
    setEditingId(customer.id);
    setEditFields({
      name: customer.name,
      phone: customer.phone ?? "",
      secondPhone: customer.second_phone ?? "",
      pageUid: customer.page_uid ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      label: customer.label ?? "",
      source: customer.source ?? "",
      state: customer.state ?? "",
      gender: customer.gender ?? "",
      nationality: customer.nationality ?? "",
      dob: customer.dob ?? "",
      notes: customer.notes ?? "",
    });
  }

  function saveEdit(id: string) {
    if (!editFields.name?.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateCustomerAction(id, {
          name: editFields.name,
          phone: editFields.phone,
          secondPhone: editFields.secondPhone,
          pageUid: editFields.pageUid,
          email: editFields.email,
          address: editFields.address,
          label: editFields.label,
          source: editFields.source,
          state: editFields.state,
          gender: editFields.gender,
          nationality: editFields.nationality,
          dob: editFields.dob,
          notes: editFields.notes,
        });
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save customer");
      }
    });
  }

  const inputClass =
    "rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]";
  // Selects need an opaque background, not bg-transparent -- the native
  // dropdown popup paints on its own surface and otherwise inherits the
  // page's light-on-dark text color against the browser's white popup,
  // washing out unselected options (see the brand-switcher screenshot bug).
  const selectClass =
    "rounded border border-black/[.15] bg-card px-3 py-1.5 text-sm text-foreground dark:border-white/[.2]";

  return (
    <div className="min-h-screen p-6">
      <h1 className="text-lg font-medium">{crmOnly ? "CRM" : "Marketing"}</h1>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {!crmOnly && (
      <section className="mt-6 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Promotions</h2>
          <select
            className={`ml-auto ${selectClass}`}
            value={currentBrandId}
            onChange={(e) => withBrandParam(e.target.value)}
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`w-32 uppercase ${inputClass}`}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`flex-1 ${inputClass}`}
          />
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as DiscountType)}
            className={selectClass}
          >
            <option value="percent">% off</option>
            <option value="fixed">$ off</option>
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Value"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className={`w-24 ${inputClass}`}
          />
          <select
            value={promoBrandId}
            onChange={(e) => setPromoBrandId(e.target.value)}
            className={selectClass}
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputClass}
            title="Starts (optional)"
          />
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={inputClass}
            title="Ends (optional)"
          />
          <button
            disabled={isPending}
            onClick={createPromotion}
            className="rounded-full bg-black px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            Add promotion
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap [&_td]:pr-4 [&_th]:pr-4">
          <thead>
            <tr className="border-b border-black/[.08] text-xs tracking-wide text-zinc-500 uppercase dark:border-white/[.145]">
              <th className="py-2">Code</th>
              <th>Description</th>
              <th>Discount</th>
              <th>Brand</th>
              <th>Window</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((p) => (
              <tr key={p.id} className="border-t border-black/[.06] dark:border-white/[.08]">
                <td className="py-2 font-medium">{p.code}</td>
                <td className="text-zinc-500">{p.description || "—"}</td>
                <td>{formatDiscount(p)}</td>
                <td>{brands.find((b) => b.id === p.brand_id)?.name ?? "All brands"}</td>
                <td className="text-xs text-zinc-500">{formatWindow(p)}</td>
                <td>
                  <button
                    onClick={() => toggleActive(p)}
                    className={p.is_active ? "text-green-600" : "text-zinc-400"}
                  >
                    {p.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="text-right">
                  <button
                    onClick={() => removePromotion(p.id)}
                    className="text-zinc-400 hover:text-red-500"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {promotions.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-sm text-zinc-500">
                  No promotions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>
      )}

      <section className="mt-6 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Customers</h2>
          <input
            type="text"
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`ml-auto ${inputClass}`}
          />
          {!crmOnly && <ImportCustomersButton kind="csv" />}
          {!crmOnly && <ImportCustomersButton kind="pdf" />}
        </div>

        {/* Filters + top-buyer ranking -- applied across ALL customers (in the
            database), not just the page on screen. */}
        <div className="mt-3 flex flex-wrap items-end gap-3 text-xs text-zinc-500">
          <label className="flex flex-col gap-1">
            Sort
            <select
              value={customerFilters.sort}
              onChange={(e) => setCustomerFilter({ sort: e.target.value === "name" ? "" : (e.target.value as CustomerSort) })}
              className={selectClass}
            >
              {(Object.keys(CUSTOMER_SORT_LABELS) as CustomerSort[]).map((s) => (
                <option key={s} value={s}>
                  {CUSTOMER_SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            State
            <select
              value={customerFilters.state}
              onChange={(e) => setCustomerFilter({ state: e.target.value })}
              className={selectClass}
            >
              <option value="">All states</option>
              {filterOptions.states.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.n.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Age
            <select
              value={customerFilters.age}
              onChange={(e) => setCustomerFilter({ age: e.target.value })}
              className={selectClass}
            >
              <option value="">All ages</option>
              {filterOptions.ages.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value} ({o.n.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Gender
            <select
              value={customerFilters.gender}
              onChange={(e) => setCustomerFilter({ gender: e.target.value })}
              className={selectClass}
            >
              <option value="">All genders</option>
              {filterOptions.genders.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === "F" ? "Female" : o.value === "M" ? "Male" : o.value} ({o.n.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
          {/* Each date range is its own group, its two dates kept side by side
              (never wrapped apart) and independent: "from" never changes "to". */}
          <div className="flex flex-col gap-1">
            Customer since
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Customer since: from"
                value={customerFilters.sinceFrom}
                onChange={(e) => setCustomerFilter({ since_from: e.target.value })}
                className={selectClass}
              />
              <span>to</span>
              <input
                type="date"
                aria-label="Customer since: to"
                value={customerFilters.sinceTo}
                onChange={(e) => setCustomerFilter({ since_to: e.target.value })}
                className={selectClass}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            Bought on
            {/* One click for the usual days, or pick a single day -- no need to
                fill both range boxes for one date. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {boughtPresets.map((p) => {
                const active = customerFilters.boughtFrom === p.from && customerFilters.boughtTo === p.to;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() =>
                      active
                        ? setCustomerFilter({ bought_from: "", bought_to: "" })
                        : setCustomerFilter({ bought_from: p.from, bought_to: p.to })
                    }
                    aria-pressed={active}
                    className={`rounded border px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "border-brand bg-brand text-white"
                        : "border-black/[.15] text-foreground hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.06]"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <input
                type="date"
                aria-label="Bought on: one day"
                title="Pick one day"
                value={customerFilters.boughtFrom && customerFilters.boughtFrom === customerFilters.boughtTo ? customerFilters.boughtFrom : ""}
                onChange={(e) => setCustomerFilter({ bought_from: e.target.value, bought_to: e.target.value })}
                className={selectClass}
              />
              <button
                type="button"
                onClick={() => setShowBoughtRange((v) => !v)}
                aria-expanded={showBoughtRange}
                className={`rounded border px-2.5 py-1.5 text-sm transition-colors ${
                  showBoughtRange
                    ? "border-brand text-brand"
                    : "border-black/[.15] text-foreground hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.06]"
                }`}
              >
                Range
              </button>
            </div>
            {showBoughtRange && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Bought on: from"
                  value={customerFilters.boughtFrom}
                  onChange={(e) => setCustomerFilter({ bought_from: e.target.value })}
                  className={selectClass}
                />
                <span>to</span>
                <input
                  type="date"
                  aria-label="Bought on: to"
                  value={customerFilters.boughtTo}
                  onChange={(e) => setCustomerFilter({ bought_to: e.target.value })}
                  className={selectClass}
                />
              </div>
            )}
          </div>
          {filtersActive && (
            <button
              onClick={clearCustomerFilters}
              className="rounded border border-black/[.15] px-3 py-1.5 text-sm text-foreground hover:bg-black/[.04] dark:border-white/[.2] dark:hover:bg-white/[.06]"
            >
              Clear filters
            </button>
          )}
        </div>

        {boughtLabel && (
          <p className="mt-3 text-sm">
            <span className="font-semibold tabular-nums">{customerTotal.toLocaleString()}</span>{" "}
            {customerTotal === 1 ? "customer" : "customers"} bought {boughtLabel}
            <span className="text-zinc-500"> -- Orders, Products and Spent below count only those days.</span>
          </p>
        )}

        {/* 18 columns don't fit at page width -- the wrapper scrolls sideways
            instead of squashing them. */}
        <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap [&_td]:pr-4 [&_th]:pr-4">
          <thead>
            <tr className="border-b border-black/[.08] text-xs tracking-wide text-zinc-500 uppercase dark:border-white/[.145]">
              <th className="py-2">Phone Number</th>
              <th>Customer Name</th>
              <th className="text-right">Orders</th>
              <th className="text-right">Products</th>
              <th className="text-right">Spent</th>
              <th>Business</th>
              <th>Email</th>
              <th>Address</th>
              <th>Customer Since</th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>PSID</th>
              <th>Capital</th>
              <th>State</th>
              <th>Age</th>
              <th>Gender</th>
              <th>Nationality</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.map((c) => (
              <Fragment key={c.id}>
                <tr
                  onClick={() => setViewing(c)}
                  title="Click to see what this customer bought"
                  className="cursor-pointer border-t border-black/[.06] hover:bg-black/[.03] dark:border-white/[.08] dark:hover:bg-white/[.05]"
                >
                  <td className="py-2">{c.phone || "—"}</td>
                  <td>{c.name}</td>
                  <td className="text-right tabular-nums">{customerBuying[c.id]?.orders ?? "—"}</td>
                  <td className="text-right tabular-nums">{customerBuying[c.id]?.units ?? "—"}</td>
                  <td className="text-right tabular-nums">
                    {customerBuying[c.id] ? formatUsd(customerBuying[c.id].spent) : "—"}
                  </td>
                  <td>{customerBusinesses[c.id]?.join(", ") || "—"}</td>
                  <td>{c.email || "—"}</td>
                  <td className="max-w-[16rem] truncate" title={c.address ?? undefined}>
                    {c.address || "—"}
                  </td>
                  <td className="text-xs text-zinc-500">{c.customer_since || "—"}</td>
                  <td>{c.first_name || "—"}</td>
                  <td>{c.last_name || "—"}</td>
                  <td>{c.page_uid || "—"}</td>
                  <td>{c.capital || "—"}</td>
                  <td>{c.state || "—"}</td>
                  <td>{c.age ?? "—"}</td>
                  <td>{c.gender || "—"}</td>
                  <td>{c.nationality || "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingId === c.id) setEditingId(null);
                        else startEdit(c);
                      }}
                      className="text-zinc-400 hover:text-black dark:hover:text-white"
                    >
                      {editingId === c.id ? "Cancel" : "Edit"}
                    </button>
                    {!crmOnly && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingCustomer(c);
                      }}
                      disabled={isPending}
                      title="Delete customer"
                      aria-label="Delete customer"
                      className="ml-3 inline-flex size-7 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      <Trash2 className="size-4" />
                    </button>
                    )}
                  </td>
                </tr>
                {editingId === c.id && (
                  <tr className="border-t border-black/[.06] dark:border-white/[.08]">
                    <td colSpan={18} className="py-3 whitespace-normal">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <input
                          placeholder="Name"
                          value={editFields.name ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, name: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Phone"
                          value={editFields.phone ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, phone: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Second phone"
                          value={editFields.secondPhone ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, secondPhone: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="PSID"
                          value={editFields.pageUid ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, pageUid: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Email"
                          value={editFields.email ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, email: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Address"
                          value={editFields.address ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, address: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Label"
                          value={editFields.label ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, label: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Source"
                          value={editFields.source ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, source: e.target.value })}
                          className={inputClass}
                        />
                        <OptionSelect
                          placeholder="State/Province"
                          value={editFields.state ?? ""}
                          onChange={(v) => setEditFields({ ...editFields, state: v })}
                          options={PROVINCES.map((p) => ({ value: p, label: p }))}
                          className={selectClass}
                        />
                        <OptionSelect
                          placeholder="Gender"
                          value={editFields.gender ?? ""}
                          onChange={(v) => setEditFields({ ...editFields, gender: v })}
                          options={CUSTOMER_GENDERS.map((g) => ({ value: g, label: g === "F" ? "F (Female)" : "M (Male)" }))}
                          className={selectClass}
                        />
                        <OptionSelect
                          placeholder="Nationality"
                          value={editFields.nationality ?? ""}
                          onChange={(v) => setEditFields({ ...editFields, nationality: v })}
                          options={CUSTOMER_NATIONALITIES.map((n) => ({ value: n, label: n }))}
                          className={selectClass}
                        />
                        <input
                          type="date"
                          value={editFields.dob ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, dob: e.target.value })}
                          className={inputClass}
                          title="Date of birth"
                        />
                        <input
                          placeholder="Notes"
                          value={editFields.notes ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, notes: e.target.value })}
                          className={`sm:col-span-2 ${inputClass}`}
                        />
                      </div>
                      <button
                        disabled={isPending}
                        onClick={() => saveEdit(c.id)}
                        className="mt-3 rounded-full bg-black px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visibleCustomers.length === 0 && (
              <tr>
                <td colSpan={18} className="py-4 text-sm text-zinc-500">
                  {search.trim() !== searchTerm.trim() ? "Searching..." : "No customers found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        {visibleCustomers.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[.08] pt-3 text-sm dark:border-white/[.145]">
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Items per page
              <select
                value={customerLimit}
                onChange={(e) => {
                  // Stay on the same page number, unless the bigger page size
                  // leaves fewer pages than that -- then land on the last one.
                  const limit = Number(e.target.value);
                  goToCustomerPage(Math.min(customerPage, Math.max(1, Math.ceil(customerTotal / limit))), limit);
                }}
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
                onClick={() => goToCustomerPage(customerPage - 1)}
                disabled={customerPage <= 1}
                className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1 text-xs disabled:opacity-30 dark:border-white/[.2]"
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </button>
              <span className="tabular-nums text-zinc-500">
                Page {customerPage} of {customerPageCount} ({customerTotal.toLocaleString()} customers)
              </span>
              <button
                onClick={() => goToCustomerPage(customerPage + 1)}
                disabled={customerPage >= customerPageCount}
                className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1 text-xs disabled:opacity-30 dark:border-white/[.2]"
              >
                Next
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      {viewingCustomer && (
        <CustomerPurchasesDialog
          customerId={viewingCustomer.id}
          name={viewingCustomer.name}
          onClose={() => setViewing(null)}
        />
      )}
      {deletingCustomer && (
        <DeleteCustomerDialog
          customerId={deletingCustomer.id}
          name={deletingCustomer.name}
          onClose={() => setDeletingCustomer(null)}
          onDeleted={() => {
            if (editingId === deletingCustomer.id) setEditingId(null);
          }}
        />
      )}
    </div>
  );
}
