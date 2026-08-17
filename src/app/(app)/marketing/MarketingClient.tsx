"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Brand, Customer, DiscountType, Promotion } from "@/types/database";
import {
  createPromotionAction,
  deletePromotionAction,
  setPromotionActiveAction,
  updateCustomerAction,
} from "./actions";

function formatDiscount(p: Promotion) {
  return p.discount_type === "percent" ? `${p.discount_value}%` : `$${p.discount_value.toFixed(2)}`;
}

function formatWindow(p: Promotion) {
  if (!p.starts_at && !p.ends_at) return "Always on";
  const start = p.starts_at ? p.starts_at.slice(0, 10) : "…";
  const end = p.ends_at ? p.ends_at.slice(0, 10) : "…";
  return `${start} → ${end}`;
}

export default function MarketingClient({
  brands,
  currentBrandId,
  promotions,
  customers,
  searchTerm,
}: {
  brands: Brand[];
  currentBrandId: string;
  promotions: Promotion[];
  customers: Customer[];
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

  function withBrandParam(brandId: string) {
    const params = new URLSearchParams();
    if (brandId) params.set("brand", brandId);
    if (searchTerm) params.set("q", searchTerm);
    router.push(`/marketing?${params.toString()}`);
  }

  function runSearch() {
    const params = new URLSearchParams();
    if (currentBrandId) params.set("brand", currentBrandId);
    if (search.trim()) params.set("q", search.trim());
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
      <h1 className="text-lg font-medium">Marketing</h1>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

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

        <table className="mt-4 w-full text-left text-sm">
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
      </section>

      <section className="mt-6 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Customers</h2>
          <input
            type="text"
            placeholder="Search name or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            className={`ml-auto ${inputClass}`}
          />
          <button onClick={runSearch} className={inputClass}>
            Search
          </button>
        </div>

        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/[.08] text-xs tracking-wide text-zinc-500 uppercase dark:border-white/[.145]">
              <th className="py-2">Name</th>
              <th>Phone</th>
              <th>Label</th>
              <th>Source</th>
              <th>Customer since</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-t border-black/[.06] dark:border-white/[.08]">
                  <td className="py-2">{c.name}</td>
                  <td>{c.phone || "—"}</td>
                  <td>{c.label || "—"}</td>
                  <td>{c.source || "—"}</td>
                  <td className="text-xs text-zinc-500">{c.customer_since || "—"}</td>
                  <td className="text-right">
                    <button
                      onClick={() => (editingId === c.id ? setEditingId(null) : startEdit(c))}
                      className="text-zinc-400 hover:text-black dark:hover:text-white"
                    >
                      {editingId === c.id ? "Cancel" : "Edit"}
                    </button>
                  </td>
                </tr>
                {editingId === c.id && (
                  <tr className="border-t border-black/[.06] dark:border-white/[.08]">
                    <td colSpan={6} className="py-3">
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
                        <input
                          placeholder="State/Province"
                          value={editFields.state ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, state: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Gender"
                          value={editFields.gender ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, gender: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          placeholder="Nationality"
                          value={editFields.nationality ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, nationality: e.target.value })}
                          className={inputClass}
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
            {customers.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-zinc-500">
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
