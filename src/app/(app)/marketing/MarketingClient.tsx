"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, Search, SlidersHorizontal, Tag, Trash2, Users, X } from "lucide-react";
import type { Brand, Customer, DiscountType, Promotion } from "@/types/database";
import { CUSTOMER_AGES, CUSTOMER_GENDERS, CUSTOMER_NATIONALITIES, PROVINCES } from "@/lib/cambodiaPlaces";
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
  exportCustomersAction,
  setPromotionActiveAction,
  updateCustomerAction,
} from "./actions";
import { exportCustomersCsv, exportCustomersPdf, openPrintWindow } from "@/lib/exportCustomers";
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

// Soft colored badges. The same text always gets the same color (a business keeps its color everywhere).
const BADGE_TONES = [
  "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "bg-rose-500/10 text-rose-700 dark:text-rose-400",
];
function toneFor(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return BADGE_TONES[h % BADGE_TONES.length];
}
// A filter that is in use is tinted, so the active ones can be seen at a glance.
const ACTIVE_FIELD = "border-brand/60 bg-brand/5 font-medium text-brand";
const dash = <span className="text-muted-foreground/50">—</span>;

// CRM "Meta Conv." column -- reflects customers.meta_sync_status, written by
// src/lib/metaConversions.ts after it actually attempts to send that customer's
// data to Meta's Conversions API (not just whether the brand is configured).
function MetaSyncBadge({ status }: { status: Customer["meta_sync_status"] }) {
  if (status === "connected") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Connected
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        Failed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      Not connected
    </span>
  );
}

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
  // The Since and Bought-on date pairs each count once.
  const activeFilterCount =
    [customerFilters.sort !== "name", !!customerFilters.state, !!customerFilters.business, !!customerFilters.age, !!customerFilters.gender].filter(Boolean).length +
    (customerFilters.sinceFrom || customerFilters.sinceTo ? 1 : 0) +
    (customerFilters.boughtFrom || customerFilters.boughtTo ? 1 : 0);
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
      business: "",
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

  // Export CSV / Export PDF: every customer matching the search and filters in use (up to the export's limit), not
  // just the page on screen.
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  async function exportCustomers(kind: "csv" | "pdf") {
    if (exporting) return;
    setError(null);
    // The PDF's window has to be opened right here, from the click, or the browser blocks it.
    let win: Window | null = null;
    try {
      if (kind === "pdf") win = openPrintWindow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the PDF");
      return;
    }
    setExporting(kind);
    try {
      const { rows, total } = await exportCustomersAction(search.trim(), customerFilters);
      const stamp = today;
      const note = `${rows.length.toLocaleString()} customer${rows.length === 1 ? "" : "s"}${
        total > rows.length ? ` (the first ${rows.length.toLocaleString()} of ${total.toLocaleString()})` : ""
      } · ${stamp}`;
      if (kind === "csv") exportCustomersCsv(rows, `customers-${stamp}.csv`);
      else if (win) exportCustomersPdf(win, rows, "Customers", note);
      if (total > rows.length) setError(`Exported the first ${rows.length.toLocaleString()} of ${total.toLocaleString()} customers: narrow the list with the filters to export the rest.`);
    } catch (e) {
      win?.close();
      setError(e instanceof Error ? e.message : "Couldn't export the customers");
    } finally {
      setExporting(null);
    }
  }

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
      pageUid: customer.page_uid ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      state: customer.state ?? "",
      age: customer.age ?? "",
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
          pageUid: editFields.pageUid,
          email: editFields.email,
          address: editFields.address,
          state: editFields.state,
          age: editFields.age,
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
    "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/20";
  // Selects need an opaque background, not bg-transparent -- the native
  // dropdown popup paints on its own surface and otherwise inherits the
  // page's light-on-dark text color against the browser's white popup,
  // washing out unselected options (see the brand-switcher screenshot bug).
  const selectClass =
    "h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{crmOnly ? "CRM" : "Marketing"}</h1>
        <p className="text-sm text-muted-foreground">
          {crmOnly ? "Your customers and what they bought." : "Promotions and customers (CRM) in one place."}
        </p>
      </div>
      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      {!crmOnly && (
      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Tag className="size-4 text-muted-foreground" /> Promotions
          </h2>
          <select
            aria-label="Business"
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

        <div className="mt-4 flex flex-wrap gap-2 rounded-xl bg-muted/40 p-3">
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
            aria-label="Discount type"
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
            aria-label="Promo business"
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
            className="h-10 rounded-lg bg-brand px-5 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:opacity-40"
          >
            Add promotion
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm whitespace-nowrap [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3">
          <thead>
            <tr className="bg-muted/60 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <th>Code</th>
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
              <tr key={p.id} className="border-t border-border transition-colors hover:bg-muted/50">
                <td className="font-semibold text-foreground">{p.code}</td>
                <td className="text-zinc-500">{p.description || "—"}</td>
                <td>{formatDiscount(p)}</td>
                <td>{brands.find((b) => b.id === p.brand_id)?.name ?? "All brands"}</td>
                <td className="text-xs text-zinc-500">{formatWindow(p)}</td>
                <td>
                  <button
                    onClick={() => toggleActive(p)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      p.is_active
                        ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    }`}
                  >
                    {p.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="text-right">
                  <button
                    onClick={() => removePromotion(p.id)}
                    aria-label="Delete promotion"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                  >
                    <X className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {promotions.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No promotions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>
      )}

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Users className="size-4 text-muted-foreground" /> Customers
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {customerTotal.toLocaleString()}
            </span>
          </h2>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search name or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`w-64 pl-9 ${inputClass}`}
            />
          </div>
          {!crmOnly && <ImportCustomersButton kind="csv" />}
          {!crmOnly && <ImportCustomersButton kind="pdf" />}
          {!crmOnly && (
            <>
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => void exportCustomers("csv")}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
              >
                {exporting === "csv" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Export CSV
              </button>
              <button
                type="button"
                disabled={exporting !== null}
                onClick={() => void exportCustomers("pdf")}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
              >
                {exporting === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                Export PDF
              </button>
            </>
          )}
        </div>

        {/* Filters + top-buyer ranking -- applied across ALL customers (in the
            database), not just the page on screen. */}
        <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-4 rounded-xl border border-border bg-muted/30 p-4 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase [&_button]:tracking-normal [&_button]:normal-case [&_input]:font-normal [&_input]:tracking-normal [&_input]:normal-case [&_select]:font-normal [&_select]:tracking-normal [&_select]:normal-case">
          <div className="flex w-full items-center justify-between normal-case">
            <p className="flex items-center gap-2 text-sm font-semibold tracking-normal text-foreground">
              <SlidersHorizontal className="size-4 text-muted-foreground" /> Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                  {activeFilterCount}
                </span>
              )}
            </p>
            {filtersActive && (
              <button
                onClick={clearCustomerFilters}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <X className="size-3.5" /> Clear filters
              </button>
            )}
          </div>
          <label className="flex flex-col gap-1">
            Sort
            <select
              value={customerFilters.sort}
              onChange={(e) => setCustomerFilter({ sort: e.target.value === "name" ? "" : (e.target.value as CustomerSort) })}
              className={`${selectClass} ${customerFilters.sort !== "name" ? ACTIVE_FIELD : ""}`}
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
              className={`${selectClass} ${customerFilters.state ? ACTIVE_FIELD : ""}`}
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
            Business
            <select
              value={customerFilters.business}
              onChange={(e) => setCustomerFilter({ business: e.target.value })}
              className={`${selectClass} ${customerFilters.business ? ACTIVE_FIELD : ""}`}
            >
              <option value="">All businesses</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Age
            <select
              value={customerFilters.age}
              onChange={(e) => setCustomerFilter({ age: e.target.value })}
              className={`${selectClass} ${customerFilters.age ? ACTIVE_FIELD : ""}`}
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
              className={`${selectClass} ${customerFilters.gender ? ACTIVE_FIELD : ""}`}
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
                className={`${selectClass} ${customerFilters.sinceFrom ? ACTIVE_FIELD : ""}`}
              />
              <span>to</span>
              <input
                type="date"
                aria-label="Customer since: to"
                value={customerFilters.sinceTo}
                onChange={(e) => setCustomerFilter({ since_to: e.target.value })}
                className={`${selectClass} ${customerFilters.sinceTo ? ACTIVE_FIELD : ""}`}
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
                    className={`h-10 rounded-lg border px-3 text-sm font-medium transition-colors ${
                      active
                        ? "border-brand bg-brand text-white shadow-sm"
                        : "border-border bg-card text-foreground hover:bg-muted"
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
                className={`h-10 rounded-lg border px-3 text-sm font-medium transition-colors ${
                  showBoughtRange
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-brand/60 bg-card text-brand hover:bg-brand/10"
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
        </div>

        {boughtLabel && (
          <p className="mt-3 text-sm">
            <span className="font-semibold tabular-nums">{customerTotal.toLocaleString()}</span>{" "}
            {customerTotal === 1 ? "customer" : "customers"} bought {boughtLabel}
            <span className="text-zinc-500"> -- Orders, Products and Spent below count only those days.</span>
          </p>
        )}

        {/* 19 columns don't fit at page width -- the wrapper scrolls sideways
            instead of squashing them. */}
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm whitespace-nowrap [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3">
          <thead>
            <tr className="bg-muted/60 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <th>Phone Number</th>
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
              <th>Meta Conv.</th>
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
                  className="cursor-pointer border-t border-border transition-colors hover:bg-muted/50"
                >
                  <td className="font-medium tabular-nums text-foreground">{c.phone || dash}</td>
                  <td className="font-medium text-foreground">{c.name}</td>
                  <td className="text-right tabular-nums">
                    {customerBuying[c.id] ? (
                      <span
                        className={`inline-block min-w-7 rounded-md px-2 py-0.5 text-center text-xs font-semibold ${
                          customerBuying[c.id].orders >= 2 ? "bg-brand/10 text-brand" : "bg-muted text-foreground"
                        }`}
                      >
                        {customerBuying[c.id].orders}
                      </span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td className="text-right tabular-nums">{customerBuying[c.id]?.units ?? dash}</td>
                  <td
                    className={`text-right font-semibold tabular-nums ${
                      customerBuying[c.id]?.spent > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                    }`}
                  >
                    {customerBuying[c.id] ? formatUsd(customerBuying[c.id].spent) : dash}
                  </td>
                  <td>
                    {customerBusinesses[c.id]?.length ? (
                      <div className="flex gap-1">
                        {customerBusinesses[c.id].map((b) => (
                          <span key={b} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${toneFor(b)}`}>
                            {b}
                          </span>
                        ))}
                      </div>
                    ) : (
                      dash
                    )}
                  </td>
                  <td className="text-muted-foreground">{c.email || dash}</td>
                  <td className="max-w-[16rem] truncate" title={c.address ?? undefined}>
                    {c.address || dash}
                  </td>
                  <td className="text-xs text-muted-foreground tabular-nums">{c.customer_since || dash}</td>
                  <td>{c.first_name || dash}</td>
                  <td>{c.last_name || dash}</td>
                  <td className="text-muted-foreground tabular-nums">{c.page_uid || dash}</td>
                  <td>
                    <MetaSyncBadge status={c.meta_sync_status} />
                  </td>
                  <td>{c.capital || dash}</td>
                  <td>
                    {c.state ? (
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{c.state}</span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td>{c.age ?? dash}</td>
                  <td>
                    {c.gender ? (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          c.gender === "F"
                            ? "bg-pink-500/10 text-pink-700 dark:text-pink-400"
                            : c.gender === "M"
                              ? "bg-sky-500/10 text-sky-700 dark:text-sky-400"
                              : "bg-muted text-foreground"
                        }`}
                      >
                        {c.gender}
                      </span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td>{c.nationality || dash}</td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingId === c.id) setEditingId(null);
                        else startEdit(c);
                      }}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                  <tr className="border-t border-border bg-muted/30">
                    <td colSpan={19} className="whitespace-normal">
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
                        <OptionSelect
                          placeholder="State/Province"
                          value={editFields.state ?? ""}
                          onChange={(v) => setEditFields({ ...editFields, state: v })}
                          options={PROVINCES.map((p) => ({ value: p, label: p }))}
                          className={selectClass}
                        />
                        <OptionSelect
                          placeholder="Age"
                          value={editFields.age ?? ""}
                          onChange={(v) => setEditFields({ ...editFields, age: v })}
                          options={CUSTOMER_AGES.map((a) => ({ value: a, label: a }))}
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
                        className="mt-3 h-10 rounded-lg bg-brand px-5 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:opacity-40"
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
                <td colSpan={18} className="py-12 text-center text-sm text-muted-foreground">
                  {search.trim() !== searchTerm.trim() ? "Searching..." : "No customers found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        {visibleCustomers.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Items per page
              <select
                value={customerLimit}
                onChange={(e) => {
                  // Stay on the same page number, unless the bigger page size
                  // leaves fewer pages than that -- then land on the last one.
                  const limit = Number(e.target.value);
                  goToCustomerPage(Math.min(customerPage, Math.max(1, Math.ceil(customerTotal / limit))), limit);
                }}
                className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground"
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
                className="flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs transition hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {customerPage} of {customerPageCount} ({customerTotal.toLocaleString()} customers)
              </span>
              <button
                onClick={() => goToCustomerPage(customerPage + 1)}
                disabled={customerPage >= customerPageCount}
                className="flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs transition hover:bg-muted disabled:opacity-30"
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
    </main>
  );
}
