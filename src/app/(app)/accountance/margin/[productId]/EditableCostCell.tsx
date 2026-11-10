"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMarginSoldAtCostAction } from "@/app/(app)/stock/actions";
import { formatUsd } from "@/lib/formatNumber";

// One "Cost per unit" row of the product margin page, editable: re-prices only the
// sales sold at this cost (see setMarginSoldAtCostAction), so a cost forgotten in
// Stock before the order can be fixed without touching the database.
export default function EditableCostCell({
  productIds,
  cost,
  brandId,
  fromDate,
  toDate,
}: {
  productIds: string[];
  cost: number;
  brandId: string;
  fromDate: string;
  toDate: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(cost));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const next = parseFloat(draft);
    if (Number.isNaN(next) || next < 0) {
      setError("Cost cannot be negative");
      return;
    }
    if (Math.round(next * 100) / 100 === cost) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      // A merged row's products may not all have sales at this cost: it is an error only if none did.
      const results = await Promise.allSettled(
        productIds.map((productId) =>
          setMarginSoldAtCostAction({ productId, fromCost: cost, toCost: next, brandId, fromDate, toDate })
        )
      );
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed && results.every((r) => r.status === "rejected")) {
        setError(failed.reason instanceof Error ? failed.reason.message : "Failed to save");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(cost));
          setError(null);
          setEditing(true);
        }}
        className="tabular-nums hover:underline"
        title="Edit this cost"
      >
        {formatUsd(cost)} <span className="text-xs text-muted-foreground">✎</span>
      </button>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          min="0"
          step="0.01"
          autoFocus
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
        />
        <button type="button" onClick={save} disabled={pending} className="text-xs font-medium text-brand hover:underline">
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={pending} className="text-xs text-muted-foreground hover:underline">
          Cancel
        </button>
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
