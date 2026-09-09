"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Ban, Check, ChevronDown, CircleCheck, Hourglass, Inbox, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { updateFulfillmentStatusAction } from "@/app/(app)/orders/actions";
import { FULFILLMENT_STATUSES, STATUS_LABELS, STATUS_STYLES } from "@/lib/orderStatus";
import type { FulfillmentStatus } from "@/types/database";

// An icon that matches each order state -- a delivery truck for "Delivered",
// an hourglass while it's being prepared, etc.
const STATUS_ICON: Record<FulfillmentStatus, LucideIcon> = {
  new_order: Inbox,
  processing: Hourglass,
  delivered: Truck,
  cancelled: Ban,
  complete: CircleCheck,
};

const STATUS_ICON_COLOR: Record<FulfillmentStatus, string> = {
  new_order: "text-blue-500",
  processing: "text-amber-500",
  delivered: "text-teal-500",
  cancelled: "text-zinc-400",
  complete: "text-green-500",
};

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
    if (next === current) return;
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
      <StatusBadgeMenu
        current={current}
        disabled={isPending}
        error={error}
        onChange={handleChange}
      />
    );
  }

  const CurrentIcon = STATUS_ICON[current];

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold print:hidden ${STATUS_STYLES[current]}`}
      >
        <CurrentIcon className="size-3.5 shrink-0" />
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

// Colour-coded status pill that opens a small menu of the other states.
// The menu is position:fixed so it isn't clipped by the orders table's own
// scroll container.
function StatusBadgeMenu({
  current,
  disabled,
  error,
  onChange,
}: {
  current: FulfillmentStatus;
  disabled: boolean;
  error: string | null;
  onChange: (next: FulfillmentStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const CurrentIcon = STATUS_ICON[current];

  useEffect(() => {
    if (!open) return;
    function place() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left });
    }
    place();
    function onDoc(e: MouseEvent) {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${STATUS_STYLES[current]}`}
      >
        <CurrentIcon className="size-3.5 shrink-0" />
        {STATUS_LABELS[current]}
        <ChevronDown
          className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {error && <span className="text-xs text-red-600">Failed</span>}
      {open && pos && (
        <div
          ref={menuRef}
          role="listbox"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }}
          className="min-w-[9rem] overflow-hidden rounded-lg border border-border bg-card py-1 text-xs shadow-lg"
        >
          {FULFILLMENT_STATUSES.map((s) => {
            const Icon = STATUS_ICON[s];
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={s === current}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-black/[.05] dark:hover:bg-white/[.08]"
              >
                {/* Icon first (matched to the state), then the label; a check
                    on the current one. */}
                <Icon className={`size-3.5 shrink-0 ${STATUS_ICON_COLOR[s]}`} />
                <span
                  className={s === current ? "font-semibold text-foreground" : "text-foreground"}
                >
                  {STATUS_LABELS[s]}
                </span>
                {s === current && <Check className="ml-auto size-3.5 shrink-0 text-brand" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
