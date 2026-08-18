"use client";

import { useState, useTransition } from "react";
import { updateFulfillmentStatusAction } from "@/app/(app)/orders/actions";
import { FULFILLMENT_STATUSES, STATUS_LABELS, STATUS_STYLES } from "@/lib/orderStatus";
import type { FulfillmentStatus } from "@/types/database";

export default function OrderStatusControl({
  orderId,
  status,
  variant = "full",
}: {
  orderId: string;
  status: FulfillmentStatus;
  variant?: "full" | "compact";
}) {
  const [current, setCurrent] = useState(status);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: FulfillmentStatus) {
    const previous = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      try {
        await updateFulfillmentStatusAction(orderId, next);
      } catch {
        setCurrent(previous);
        setError("Failed to update status");
      }
    });
  }

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <select
          value={current}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.value as FulfillmentStatus)}
          className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${STATUS_STYLES[current]}`}
        >
          {FULFILLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {error && <span className="text-xs text-red-600">Failed</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold print:hidden ${STATUS_STYLES[current]}`}
      >
        {STATUS_LABELS[current]}
      </span>
      <span className="hidden text-xs font-semibold print:inline">{STATUS_LABELS[current]}</span>
      <select
        value={current}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as FulfillmentStatus)}
        className="print:hidden rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 disabled:opacity-50"
      >
        {FULFILLMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600 print:hidden">{error}</span>}
    </div>
  );
}
