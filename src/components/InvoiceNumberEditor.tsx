"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, RefreshCw, X } from "lucide-react";
import { setInvoiceNumberAction } from "@/app/(app)/orders/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";

// The order's invoice number as the page heading, with a pencil to type in a
// different one. Saving it blank goes back to the automatic YYYYMM-N number.
export default function InvoiceNumberEditor({
  orderId,
  invoiceNumber,
  isCustom,
}: {
  orderId: string;
  invoiceNumber: string;
  isCustom: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(invoiceNumber);

  async function save(value: string) {
    setSaving(true);
    setError(null);
    try {
      await setInvoiceNumberAction(orderId, value);
      notifyOrdersChanged();
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the invoice number.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{invoiceNumber}</h1>
        <button
          type="button"
          onClick={() => {
            setDraft(invoiceNumber);
            setError(null);
            setEditing(true);
          }}
          aria-label="Edit invoice number"
          title="Edit invoice number"
          className="rounded p-1 text-muted-foreground hover:bg-black/[.04] hover:text-foreground dark:hover:bg-white/[.06]"
        >
          <Pencil className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save(draft);
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={40}
          aria-label="Invoice number"
          className="w-44 rounded border border-border bg-transparent px-2 py-1 text-lg font-semibold outline-none focus:border-foreground/40"
        />
        <button
          type="button"
          onClick={() => save(draft)}
          disabled={saving}
          aria-label="Save invoice number"
          className="rounded bg-brand p-1.5 text-white disabled:opacity-50"
        >
          {saving ? <RefreshCw className="size-4 animate-spin" /> : <Check className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          aria-label="Cancel"
          className="rounded border border-border p-1.5 hover:bg-black/[.04] disabled:opacity-50 dark:hover:bg-white/[.06]"
        >
          <X className="size-4" />
        </button>
      </div>
      {isCustom && (
        <button
          type="button"
          onClick={() => save("")}
          disabled={saving}
          className="mt-1 text-xs text-muted-foreground underline hover:no-underline disabled:opacity-50"
        >
          Back to automatic number
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
