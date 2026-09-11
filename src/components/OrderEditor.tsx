"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { updateOrderAction } from "@/app/(app)/orders/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

type Row = {
  key: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
};

export type OrderEditorItem = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
};

let rowSeq = 0;
function toRows(items: OrderEditorItem[]): Row[] {
  return items.map((i) => ({ key: `r${rowSeq++}`, ...i }));
}

export default function OrderEditor({
  orderId,
  brands,
  brandId,
  customerName,
  customerPhone,
  customerAddress,
  deliveryLabel,
  discount,
  deliveryFee,
  note,
  items,
}: {
  orderId: string;
  brands: { id: string; name: string }[];
  brandId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  deliveryLabel: string | null;
  discount: number;
  deliveryFee: number;
  note: string;
  items: OrderEditorItem[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft fields, only meaningful while editing.
  const [draft, setDraft] = useState<Row[]>([]);
  const [dPhone, setDPhone] = useState("");
  const [dName, setDName] = useState("");
  const [dAddress, setDAddress] = useState("");
  const [dBrandId, setDBrandId] = useState(brandId);
  const [dPercent, setDPercent] = useState("");
  const [dMinus, setDMinus] = useState("");
  const [dDelivery, setDDelivery] = useState("");
  const [dNote, setDNote] = useState("");

  const viewRows = useMemo(() => toRows(items), [items]);
  const rows = editing ? draft : viewRows;

  const subtotal = rows.reduce((s, r) => s + r.quantity * r.unitPrice, 0);
  const liveDiscount = editing
    ? Math.min(
        subtotal,
        subtotal * ((Number(dPercent) || 0) / 100) + (Number(dMinus) || 0)
      )
    : discount;
  const liveDelivery = editing ? Number(dDelivery) || 0 : deliveryFee;
  const total = Math.max(0, subtotal - liveDiscount + liveDelivery);

  const brandName = brands.find((b) => b.id === brandId)?.name ?? "—";

  function startEdit() {
    setDraft(toRows(items));
    setDPhone(customerPhone);
    setDName(customerName);
    setDAddress(customerAddress);
    setDBrandId(brandId);
    setDPercent("");
    setDMinus(discount ? String(discount) : "");
    setDDelivery(deliveryFee ? String(deliveryFee) : "");
    setDNote(note);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setError(null);
    setEditing(false);
  }

  function patchRow(key: string, patch: Partial<Row>) {
    setDraft((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setDraft((rs) => rs.filter((r) => r.key !== key));
  }

  async function save() {
    const payload = draft
      .filter((r) => r.quantity > 0)
      .map((r) => ({ productId: r.productId, quantity: r.quantity, unitPrice: r.unitPrice }));
    if (payload.length === 0) {
      setError("An order needs at least one product.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateOrderAction(orderId, {
        customerName: dName,
        customerPhone: dPhone,
        customerAddress: dAddress,
        brandId: dBrandId,
        items: payload,
        discountPercent: Number(dPercent) || 0,
        minusAmount: Number(dMinus) || 0,
        deliveryFee: Number(dDelivery) || 0,
        note: dNote,
      });
      notifyOrdersChanged();
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the changes.");
    } finally {
      setSaving(false);
    }
  }

  const fieldCls =
    "w-full rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-foreground/40";

  return (
    <div>
      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Order details
        </h2>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] dark:hover:bg-white/[.06]"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50 dark:hover:bg-white/[.06]"
            >
              <X className="size-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <div>
          <p className="mb-1 text-muted-foreground">Phone Number</p>
          {editing ? (
            <input
              value={dPhone}
              onChange={(e) => setDPhone(e.target.value)}
              className={fieldCls}
            />
          ) : (
            <p className="font-medium">{customerPhone || "—"}</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-muted-foreground">Address</p>
          {editing ? (
            <input
              value={dAddress}
              onChange={(e) => setDAddress(e.target.value)}
              className={fieldCls}
            />
          ) : (
            <p className="font-medium">{customerAddress || "—"}</p>
          )}
        </div>
        <div>
          <p className="mb-1 text-muted-foreground">Business</p>
          {editing ? (
            <select
              value={dBrandId}
              onChange={(e) => setDBrandId(e.target.value)}
              className={fieldCls}
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="font-medium">{brandName}</p>
          )}
        </div>
        {editing && (
          <div className="col-span-2 sm:col-span-3">
            <p className="mb-1 text-muted-foreground">Customer name</p>
            <input
              value={dName}
              onChange={(e) => setDName(e.target.value)}
              className={`${fieldCls} max-w-xs`}
            />
          </div>
        )}
        {deliveryLabel && (
          <div>
            <p className="mb-1 text-muted-foreground">Requested delivery</p>
            <p className="font-medium">{deliveryLabel}</p>
          </div>
        )}
        {(editing || note) && (
          <div className="col-span-2 sm:col-span-3">
            <p className="mb-1 text-muted-foreground">Description</p>
            {editing ? (
              <textarea
                rows={2}
                value={dNote}
                onChange={(e) => setDNote(e.target.value)}
                placeholder="Note for this order"
                className={`${fieldCls} resize-y`}
              />
            ) : (
              <p className="font-medium whitespace-pre-wrap">{note}</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-semibold">Products</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {rows.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                <th className="py-2">Product Name</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2">Unit</th>
                <th className="py-2 text-right">Unit Price</th>
                <th className="py-2 text-right">Total</th>
                {editing && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border">
                  <td className="py-2 pr-2">{r.name}</td>
                  <td className="py-2 text-right">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={r.quantity === 0 ? "" : r.quantity}
                        onChange={(e) =>
                          patchRow(r.key, {
                            quantity: e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                          })
                        }
                        className="w-16 rounded border border-border bg-transparent px-2 py-1 text-right text-sm"
                      />
                    ) : (
                      r.quantity
                    )}
                  </td>
                  <td className="py-2">{r.unit}</td>
                  <td className="py-2 text-right">
                    {editing ? (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.unitPrice === 0 ? "" : r.unitPrice}
                        onChange={(e) =>
                          patchRow(r.key, {
                            unitPrice:
                              e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
                          })
                        }
                        className="w-20 rounded border border-border bg-transparent px-2 py-1 text-right text-sm"
                      />
                    ) : (
                      formatMoney(r.unitPrice)
                    )}
                  </td>
                  <td className="py-2 text-right font-medium text-success">
                    {formatMoney(r.quantity * r.unitPrice)}
                  </td>
                  {editing && (
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(r.key)}
                        className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                        title="Remove product"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={editing ? 6 : 5}
                    className="py-3 text-center text-xs text-muted-foreground"
                  >
                    No products yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Adding a product opens the full Sales screen with this order's
            cart, customer and totals already loaded -- staff pick from the
            catalog there and hit "Update order" to save it back. */}
        <Link
          href={`/sales?editOrder=${orderId}`}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-foreground/40 hover:text-foreground"
        >
          <Plus className="size-4" />
          Add product
        </Link>
      </div>

      <div className="mt-6 ml-auto flex max-w-xs flex-col gap-1.5 text-sm">
        {editing ? (
          <>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Discount %</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={dPercent}
                onChange={(e) => setDPercent(e.target.value)}
                placeholder="0"
                className="w-24 rounded border border-border bg-transparent px-2 py-1 text-right"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Minus $</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={dMinus}
                onChange={(e) => setDMinus(e.target.value)}
                placeholder="0"
                className="w-24 rounded border border-border bg-transparent px-2 py-1 text-right"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Delivery $</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={dDelivery}
                onChange={(e) => setDDelivery(e.target.value)}
                placeholder="0"
                className="w-24 rounded border border-border bg-transparent px-2 py-1 text-right"
              />
            </label>
          </>
        ) : (
          <>
            {discount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span>-{formatMoney(discount)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Delivery</span>
                <span>{formatMoney(deliveryFee)}</span>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        {editing && liveDiscount > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Discount</span>
            <span>-{formatMoney(liveDiscount)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-bold text-success">
          <span>Grand Total</span>
          <span>{formatMoney(total)}</span>
        </div>
      </div>

      {error && <p className="mt-3 text-right text-sm text-red-500">{error}</p>}
    </div>
  );
}
