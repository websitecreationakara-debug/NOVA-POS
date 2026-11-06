"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Receipt, Search, Trash2, TriangleAlert, X } from "lucide-react";
import TopBarSlot from "@/components/TopBarSlot";
import { formatUsd } from "@/lib/formatNumber";
import type { Brand } from "@/types/database";
import {
  createSupplierInvoiceAction,
  deleteSupplierInvoiceAction,
  loadInvoiceFormDataAction,
  setSupplierInvoicePaidAction,
  updateSupplierInvoiceAction,
} from "./actions";
import type { InvoiceFormData } from "./types";

// The lookups the form uses on its product data (see loadInvoiceFormDataAction).
function buildLookups(data: InvoiceFormData | null) {
  const products = data?.products ?? [];
  const ledgerProducts = data?.ledgerProducts ?? [];
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const ledgerByName = new Map(ledgerProducts.map((p) => [p.name.trim().toLowerCase(), p]));
  return {
    byName,
    ledgerByName,
    // The dropdown lists each name once: the ledger can hold the same name twice (e.g. added in two months).
    ledgerNames: [...ledgerByName.values()],
    ledgerBySku: new Map(ledgerProducts.filter((p) => p.sku).map((p) => [p.sku.trim().toLowerCase(), p])),
    bySku: new Map(products.filter((p) => p.sku?.trim()).map((p) => [p.sku!.trim().toLowerCase(), p])),
  };
}

export type InvoiceRow = {
  id: string;
  supplierName: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  total: number;
  paid: boolean;
  note: string | null;
  exchangeRate: number | null;
  items: {
    id: string;
    sku: string | null;
    productName: string;
    // false for a line that is not a product of the business: it did not touch Stock.
    inStock: boolean;
    productId: string | null;
    packing: string | null;
    unit: string | null;
    quantity: number;
    unitCost: number;
  }[];
};

// A line in the form, laid out like the paper invoice: SKU, description, packing, unit, quantity, unit price.
// The product is found by its SKU or its name; the rest is text.
// A line of an invoice being edited keeps the Stock product it was linked to (while its name is unchanged),
// even if that product can no longer be found by name.
type Line = {
  key: number;
  sku: string;
  name: string;
  packing: string;
  unit: string;
  quantity: string;
  unitCost: string;
  linkedId?: string;
  linkedName?: string;
};
const blankLine = (key: number): Line => ({ key, sku: "", name: "", packing: "", unit: "", quantity: "", unitCost: "" });

// What the page was loaded with: the search/filters in the URL and the paging that came back.
export type InvoiceList = {
  q: string;
  status: "" | "paid" | "unpaid";
  from: string;
  to: string;
  page: number;
  pageCount: number;
  limit: number;
  matching: number;
  pageSizes: number[];
};

const input =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-brand focus:ring-2 focus:ring-brand/20";
const label = "mb-1.5 block text-xs font-medium text-muted-foreground";
const LINE_COLS = "sm:grid-cols-[7rem_1fr_6rem_5rem_5rem_6rem_6rem_2rem]";

export default function SupplierInvoicesClient({
  brands,
  currentBrandId,
  today,
  invoices,
  list,
}: {
  brands: Brand[];
  currentBrandId: string;
  today: string;
  invoices: InvoiceRow[];
  list: InvoiceList;
}) {
  const router = useRouter();
  const listId = useId();
  // The products the form looks lines up in are loaded when the form is opened, not with every visit to the
  // page (or every keystroke in the search, which reloads it): the list of invoices is all the page needs.
  const [formData, setFormData] = useState<InvoiceFormData | null>(null);
  const [formDataLoading, setFormDataLoading] = useState(false);
  const formDataRequest = useRef<{ brandId: string; promise: Promise<InvoiceFormData> } | null>(null);
  function ensureFormData(): Promise<InvoiceFormData> {
    if (formData?.brandId === currentBrandId) return Promise.resolve(formData);
    if (formDataRequest.current?.brandId === currentBrandId) return formDataRequest.current.promise;
    setFormDataLoading(true);
    const brandId = currentBrandId;
    const promise = loadInvoiceFormDataAction({ brandId })
      .then((data) => {
        setFormData(data);
        return data;
      })
      .finally(() => {
        setFormDataLoading(false);
        if (formDataRequest.current?.promise === promise) formDataRequest.current = null;
      });
    formDataRequest.current = { brandId, promise };
    return promise;
  }
  const { byName, ledgerByName, ledgerNames, ledgerBySku, bySku } = useMemo(
    () => buildLookups(formData?.brandId === currentBrandId ? formData : null),
    [formData, currentBrandId]
  );

  const [adding, setAdding] = useState(false);
  // The invoice being edited in the form (null = a new one).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [supplier, setSupplier] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(today);
  const [paid, setPaid] = useState(false);
  const [note, setNote] = useState("");
  const [rate, setRate] = useState("");
  const [nextKey, setNextKey] = useState(2);
  const [lines, setLines] = useState<Line[]>([blankLine(1)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const deleting = invoices.find((i) => i.id === confirmDelete) ?? null;
  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  function setLine(key: number, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // Typing a SKU or a name that is a product fills in the rest of its line: the other one, its unit,
        // and the cost it has now (to be changed to what the invoice says).
        // A ledger product linked to a Stock product (named differently, or of another business) is that Stock
        // product: its unit and cost fill in the line.
        const linkedStock = patch.name !== undefined ? ledgerByName.get(patch.name.trim().toLowerCase())?.stock : null;
        const hit =
          patch.sku !== undefined
            ? bySku.get(patch.sku.trim().toLowerCase())
            : patch.name !== undefined
              ? (linkedStock
                  ? { name: patch.name, sku: linkedStock.sku, unit: linkedStock.unit, costPrice: linkedStock.costPrice }
                  : byName.get(patch.name.trim().toLowerCase()))
              : undefined;
        if (hit) {
          // Typing a SKU shows the product's own name; a name the user typed or picked stays as it is.
          if (patch.sku !== undefined) next.name = hit.name;
          else if (!next.sku) next.sku = hit.sku ?? "";
          if (!next.unit) next.unit = hit.unit;
          if (!next.unitCost && hit.costPrice !== null) next.unitCost = String(hit.costPrice);
        }
        // A Daily Ledger product fills in what Stock didn't: its SKU and unit -- and typing a ledger SKU
        // fills in its name.
        if (patch.name !== undefined) {
          const lh = ledgerByName.get(patch.name.trim().toLowerCase());
          if (lh) {
            if (!next.sku) next.sku = lh.sku;
            if (!next.unit) next.unit = lh.unit;
          }
        } else if (!hit && patch.sku !== undefined) {
          const lh = ledgerBySku.get(patch.sku.trim().toLowerCase());
          if (lh) {
            next.name = lh.name;
            if (!next.unit) next.unit = lh.unit;
          }
        }
        return next;
      })
    );
  }

  function reset() {
    setSupplier("");
    setNumber("");
    setDate(today);
    setPaid(false);
    setNote("");
    setRate("");
    setLines([blankLine(nextKey)]);
    setNextKey(nextKey + 1);
    setEditingId(null);
    setError(null);
  }

  // Opens the form filled with a saved invoice. Saving it replaces that invoice (Stock, costs and the Daily
  // Ledger are put back as before it, then the edited one is applied).
  function startEdit(inv: InvoiceRow) {
    setEditingId(inv.id);
    setSupplier(inv.supplierName);
    setNumber(inv.invoiceNumber ?? "");
    setDate(inv.invoiceDate);
    setPaid(inv.paid);
    setNote(inv.note ?? "");
    setRate(inv.exchangeRate === null ? "" : String(inv.exchangeRate));
    setLines(
      inv.items.map((i, n) => ({
        key: nextKey + n,
        sku: i.sku ?? "",
        name: i.productName,
        packing: i.packing ?? "",
        unit: i.unit ?? "",
        quantity: String(i.quantity),
        unitCost: String(i.unitCost),
        linkedId: i.productId ?? undefined,
        linkedName: i.productName,
      }))
    );
    setNextKey(nextKey + inv.items.length + 1);
    setError(null);
    setAdding(true);
    void ensureFormData().catch(() => {});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setError(null);
    // Lines are matched to products by name or SKU: wait for the product data if it hasn't arrived yet.
    let lookups: ReturnType<typeof buildLookups>;
    try {
      lookups = buildLookups(await ensureFormData());
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Could not load the products");
    }
    const resolved: {
      productId: string | null;
      description: string;
      sku: string;
      packing: string;
      unit: string;
      quantity: number;
      unitCost: number;
    }[] = [];
    for (const l of lines) {
      if (!l.sku.trim() && !l.name.trim() && !l.quantity && !l.unitCost) continue;
      // A name or SKU that is a product of the business adds to its Stock; anything else is kept as typed.
      // A ledger product linked to a Stock product counts as that Stock product, whatever its name.
      const ledgerLink = lookups.ledgerByName.get(l.name.trim().toLowerCase())?.stockProductId ?? null;
      const product = lookups.byName.get(l.name.trim().toLowerCase()) ?? lookups.bySku.get(l.sku.trim().toLowerCase());
      const keptLink = l.linkedId && l.name.trim() === l.linkedName ? l.linkedId : null;
      if (!product && !keptLink && !ledgerLink && !l.name.trim()) return setError("Type a description on every line.");
      resolved.push({
        productId: ledgerLink ?? product?.id ?? keptLink,
        description: l.name,
        sku: l.sku,
        packing: l.packing,
        unit: l.unit,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
      });
    }
    setSaving(true);
    try {
      const invoice = {
        brandId: currentBrandId,
        supplierName: supplier,
        invoiceNumber: number,
        invoiceDate: date,
        paid,
        note,
        exchangeRate: rate.trim() ? Number(rate.replace(/,/g, "")) : null,
        lines: resolved,
      };
      if (editingId) await updateSupplierInvoiceAction({ ...invoice, invoiceId: editingId });
      else await createSupplierInvoiceAction(invoice);
      reset();
      setAdding(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the invoice");
    } finally {
      setSaving(false);
    }
  }

  // Search, filters and paging live in the URL (the page reads them), so a refresh or a shared link
  // keeps them. Changing a filter goes back to page 1; the business is kept.
  function go(patch: Partial<Record<"q" | "status" | "from" | "to" | "page" | "limit", string>>) {
    const next: Record<string, string> = {
      q: list.q,
      status: list.status,
      from: list.from,
      to: list.to,
      page: String(list.page),
      limit: String(list.limit),
      ...patch,
    };
    if (!("page" in patch)) next.page = "1";
    const params = new URLSearchParams({ brand: currentBrandId });
    if (next.q) params.set("q", next.q);
    if (next.status) params.set("status", next.status);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    params.set("page", next.page);
    params.set("limit", next.limit);
    router.replace(`/stock/invoices?${params}`);
  }

  // The search box waits for a pause in typing before it reloads the list.
  const [search, setSearch] = useState(list.q);
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    if (search.trim() === list.q) return;
    const t = setTimeout(() => goRef.current({ q: search.trim() }), 350);
    return () => clearTimeout(t);
  }, [search, list.q]);

  // Arriving without ?page=&limit= (the sidebar link): write them into the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("page") || !params.has("limit")) goRef.current({ page: String(list.page) });
  }, [list.page]);

  const filtered = !!(list.q || list.status || list.from || list.to);

  async function togglePaid(inv: InvoiceRow) {
    if (payingId) return;
    setPayingId(inv.id);
    setError(null);
    try {
      await setSupplierInvoicePaidAction({ invoiceId: inv.id, paid: !inv.paid });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the payment status");
    } finally {
      setPayingId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await deleteSupplierInvoiceAction({ invoiceId: id });
      setConfirmDelete(null);
      router.refresh();
    } catch (e) {
      setConfirmDelete(null);
      setError(e instanceof Error ? e.message : "Could not delete the invoice");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBarSlot>
        <select
          aria-label="Business"
          className="min-w-0 max-w-[10.5rem] rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground sm:max-w-none"
          value={currentBrandId}
          onChange={(e) => router.push(`/stock/invoices?brand=${e.target.value}&page=1&limit=${list.limit}`)}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <h1 className="hidden items-center gap-2 text-sm sm:flex">
          <Link href={`/stock?brand=${currentBrandId}`} className="text-muted-foreground hover:underline">
            Stock
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-foreground">Supplier Invoices</span>
        </h1>
      </TopBarSlot>

      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Supplier Invoices</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Saving an invoice adds its quantities to Stock and the Daily Ledger, and sets each product&apos;s cost to the
              unit cost on the invoice. A line that isn&apos;t a product of this business is only recorded.
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                void ensureFormData().catch(() => {});
              }}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white shadow-sm transition hover:brightness-95 active:scale-[0.98]"
            >
              <Plus className="size-4" /> Add invoice
            </button>
          )}
        </div>

        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}

        {adding && (
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              {editingId ? "Edit invoice" : "New invoice"}
              {formDataLoading && (
                <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Loading products…
                </span>
              )}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className={label}>Supplier</label>
                <input className={input} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" />
              </div>
              <div>
                <label className={label}>Invoice no.</label>
                <input className={input} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className={label}>Invoice date</label>
                <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className={label}>Exchange rate (៛ per $1)</label>
                <input
                  className={input}
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder="e.g. 4,100"
                />
              </div>
              <label className="flex h-10 items-center gap-2 self-end rounded-lg border border-border bg-background px-3 text-sm text-foreground">
                <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={paid} onChange={(e) => setPaid(e.target.checked)} />{" "}
                Already paid
              </label>
            </div>

            <datalist id={listId}>
              {ledgerNames.map((p) => (
                <option key={p.name} value={p.name} label={p.sku || undefined} />
              ))}
            </datalist>
            <div className="mt-6 space-y-2 rounded-xl border border-border bg-muted/40 p-3">
              <div className={`hidden ${LINE_COLS} gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid`}>
                <span>SKU</span>
                <span>Description</span>
                <span>Packing</span>
                <span>Unit</span>
                <span>Qty</span>
                <span>Unit price</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {lines.map((l) => (
                <div
                  key={l.key}
                  className={`grid grid-cols-4 items-center gap-2 ${LINE_COLS}`}
                >
                  <input
                    className={`${input} col-span-2 sm:col-span-1`}
                    value={l.sku}
                    onChange={(e) => setLine(l.key, { sku: e.target.value })}
                    placeholder="SKU"
                  />
                  <input
                    className={`${input} col-span-2 sm:col-span-1`}
                    list={listId}
                    value={l.name}
                    onChange={(e) => setLine(l.key, { name: e.target.value })}
                    placeholder="Search a product or type any name"
                  />
                  <input
                    className={input}
                    value={l.packing}
                    onChange={(e) => setLine(l.key, { packing: e.target.value })}
                    placeholder="Packing"
                  />
                  <input
                    className={input}
                    value={l.unit}
                    onChange={(e) => setLine(l.key, { unit: e.target.value })}
                    placeholder="Unit"
                  />
                  <input
                    className={input}
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                    placeholder="Qty"
                  />
                  <input
                    className={input}
                    inputMode="decimal"
                    value={l.unitCost}
                    onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                    placeholder="$ each"
                  />
                  <span className="hidden text-right text-sm font-medium tabular-nums sm:block">
                    {formatUsd((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove line"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-red-500 disabled:opacity-30"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setLines((ls) => [...ls, blankLine(nextKey)]);
                  setNextKey(nextKey + 1);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-brand transition hover:bg-brand/10"
              >
                <Plus className="size-4" /> Add product
              </button>
            </div>

            <div className="mt-5">
              <label className={label}>Note</label>
              <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <p className="text-sm text-muted-foreground">
                Invoice total <span className="ml-1 text-xl font-semibold tabular-nums text-foreground">{formatUsd(total)}</span>
                {Number(rate.replace(/,/g, "")) > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · ៛{Math.round(total * Number(rate.replace(/,/g, ""))).toLocaleString("en-US")}
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    reset();
                    setAdding(false);
                  }}
                  className="h-10 rounded-lg border border-border px-4 text-sm font-medium transition hover:bg-muted disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={save}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-white shadow-sm transition hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />} {editingId ? "Save changes" : "Save invoice"}
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label="Search invoices"
              placeholder="Search supplier, invoice no., SKU or product"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${input} pl-9`}
            />
          </div>
          <select
            aria-label="Filter by payment"
            value={list.status}
            onChange={(e) => go({ status: e.target.value })}
            className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="">All invoices</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            From
            <input
              type="date"
              value={list.from}
              max={list.to || undefined}
              onChange={(e) => go({ from: e.target.value })}
              className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            To
            <input
              type="date"
              value={list.to}
              min={list.from || undefined}
              onChange={(e) => go({ to: e.target.value })}
              className="h-10 rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                go({ q: "", status: "", from: "", to: "" });
              }}
              className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" /> Clear
            </button>
          )}
          <span className="ml-auto px-2 text-xs font-medium text-muted-foreground">
            {list.matching} invoice{list.matching === 1 ? "" : "s"}
          </span>
        </div>

        {invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <Receipt className="size-5" />
            </span>
            <p className="text-sm font-medium text-foreground">{filtered ? "No matching invoices" : "No supplier invoices yet"}</p>
            <p className="text-sm text-muted-foreground">
              {filtered ? "Try a different search or clear the filters." : "Add your first invoice to record what you bought in."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {invoices.map((inv) => {
              const isOpen = open === inv.id;
              return (
                <li
                  key={inv.id}
                  className={`overflow-hidden rounded-2xl border bg-card shadow-sm transition ${isOpen ? "border-brand/40" : "border-border hover:border-foreground/20"}`}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : inv.id)}
                    className="flex w-full items-center gap-4 px-4 py-4 text-left sm:px-5"
                  >
                    <span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand sm:grid">
                      <Receipt className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {inv.supplierName}
                        {inv.invoiceNumber && (
                          <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                            #{inv.invoiceNumber}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {inv.invoiceDate} · {inv.items.length} product{inv.items.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    {/* Click to flip Paid / Unpaid. A span, not a button: it sits inside the row's own button. */}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={inv.paid ? "Paid -- click to mark unpaid" : "Unpaid -- click to mark paid"}
                      title={inv.paid ? "Click to mark unpaid" : "Click to mark paid"}
                      onClick={(e) => {
                        e.stopPropagation();
                        void togglePaid(inv);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          void togglePaid(inv);
                        }
                      }}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-95 ${
                        payingId === inv.id ? "opacity-60" : ""
                      } ${inv.paid ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600"}`}
                    >
                      {payingId === inv.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <span className={`size-1.5 rounded-full ${inv.paid ? "bg-green-500" : "bg-amber-500"}`} />
                      )}
                      {inv.paid ? "Paid" : "Unpaid"}
                    </span>
                    <span className="w-24 text-right text-base font-semibold tabular-nums text-foreground">{formatUsd(inv.total)}</span>
                    <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-border bg-muted/30 px-4 py-4 sm:px-5">
                      <div className="overflow-x-auto rounded-xl border border-border bg-card">
                        <table className="w-full min-w-[34rem] text-sm">
                          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">SKU</th>
                              <th className="px-3 py-2 font-medium">Description</th>
                              <th className="px-3 py-2 font-medium">Packing</th>
                              <th className="px-3 py-2 font-medium">Unit</th>
                              <th className="px-3 py-2 text-right font-medium">Qty</th>
                              <th className="px-3 py-2 text-right font-medium">Unit cost</th>
                              <th className="px-3 py-2 text-right font-medium">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.items.map((i) => (
                              <tr key={i.id} className="border-t border-border/60">
                                <td className="px-3 py-2.5 text-muted-foreground">{i.sku}</td>
                                <td className="px-3 py-2.5 font-medium">
                                  {i.productName}
                                  {!i.inStock && (
                                    <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                                      not in Stock
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5">{i.packing}</td>
                                <td className="px-3 py-2.5">{i.unit}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{i.quantity}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums">{formatUsd(i.unitCost)}</td>
                                <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatUsd(i.quantity * i.unitCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {inv.exchangeRate !== null && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Exchange rate 1$ = ៛{inv.exchangeRate.toLocaleString("en-US")} · total ៛
                          {Math.round(inv.total * inv.exchangeRate).toLocaleString("en-US")}
                        </p>
                      )}
                      {inv.note && <p className="mt-2 text-sm text-muted-foreground">{inv.note}</p>}
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(inv)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-brand/40 hover:bg-brand/10 hover:text-brand"
                        >
                          <Pencil className="size-4" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(inv.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
                        >
                          <Trash2 className="size-4" /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {list.matching > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Items per page
              <select
                value={list.limit}
                onChange={(e) => go({ limit: e.target.value })}
                className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-brand"
              >
                {list.pageSizes.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => go({ page: String(list.page - 1) })}
                disabled={list.page <= 1}
                className="flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs transition hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </button>
              <span className="tabular-nums text-muted-foreground">
                Page {list.page} of {list.pageCount}
              </span>
              <button
                type="button"
                onClick={() => go({ page: String(list.page + 1) })}
                disabled={list.page >= list.pageCount}
                className="flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs transition hover:bg-muted disabled:opacity-30"
              >
                Next
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {deleting && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!busyId) setConfirmDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete this invoice?"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
              <TriangleAlert className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">Delete this invoice?</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              &ldquo;{deleting.supplierName}
              {deleting.invoiceNumber ? ` #${deleting.invoiceNumber}` : ""}&rdquo; ({formatUsd(deleting.total)}) will be removed. Its quantities
              are taken back out of Stock and the Daily Ledger, and product costs go back to what they were before it.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => void remove(deleting.id)}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {busyId ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
