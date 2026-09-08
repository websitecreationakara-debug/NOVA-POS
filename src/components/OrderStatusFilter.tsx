"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FULFILLMENT_STATUSES, STATUS_LABELS } from "@/lib/orderStatus";
import type { FulfillmentStatus } from "@/types/database";

type Chip = { key: string; label: string; value: FulfillmentStatus | null };

const CHIPS: Chip[] = [
  { key: "all", label: "All", value: null },
  ...FULFILLMENT_STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s], value: s })),
];

// Client-side status filter for /orders. Navigates as a transition so the
// current list stays on screen (no white flash) while the next page loads,
// and highlights the tapped chip immediately instead of waiting for the
// round-trip to come back with a new `active` prop.
export default function OrderStatusFilter({ active }: { active: FulfillmentStatus | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Where the in-flight navigation is heading. Only trusted while `isPending`;
  // once the server catches up we fall back to the real `active` prop, so a
  // cancelled or redirected navigation can't leave the wrong chip lit.
  const [target, setTarget] = useState<FulfillmentStatus | null>(active);
  const shown = isPending ? target : active;

  function go(value: FulfillmentStatus | null) {
    if (value === shown) return;
    setTarget(value);
    startTransition(() => {
      router.push(value ? `/orders?status=${value}` : "/orders");
    });
  }

  return (
    <div className="flex flex-wrap gap-2 px-6 py-4" aria-busy={isPending}>
      {CHIPS.map((c) => {
        const isActive = c.value === shown;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => go(c.value)}
            aria-pressed={isActive}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-95 ${
              isActive
                ? "bg-brand text-black"
                : "bg-muted text-muted-foreground hover:bg-black/[.06] hover:text-foreground dark:hover:bg-white/[.08]"
            } ${isPending ? "cursor-progress" : ""}`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
