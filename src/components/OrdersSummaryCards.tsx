"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Eye, EyeOff } from "lucide-react";
import { formatCount } from "@/lib/formatNumber";

const STORAGE_KEY = "nova:orders-summary-hidden";
const CHANGE_EVENT = "nova:orders-summary-hidden-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setHidden(hidden: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // storage blocked -- the choice just isn't remembered
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export type OrdersSummaryCard = { label: string; value: number; href: string; active?: boolean };

// The Orders page's count cards, with a button to hide them (more room for the list)
// and show them again. The choice is remembered in this browser.
export default function OrdersSummaryCards({ cards }: { cards: OrdersSummaryCard[] }) {
  const hidden = useSyncExternalStore(subscribe, getHidden, () => false);

  return (
    <div className="px-3 pt-3 sm:px-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setHidden(!hidden)}
          aria-expanded={!hidden}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-black/[.04] hover:text-foreground dark:hover:bg-white/[.06]"
        >
          {hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          {hidden ? "Show summary" : "Hide summary"}
        </button>
      </div>
      {!hidden && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {cards.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className={`rounded-xl border bg-card px-3 py-2.5 transition-colors hover:border-foreground/20 sm:px-4 sm:py-3 ${
                s.active ? "border-orange-400" : "border-border"
              }`}
            >
              <p className="text-[11px] leading-tight font-medium tracking-wide text-muted-foreground uppercase sm:text-xs">
                {s.label}
              </p>
              <p className="font-display mt-0.5 text-2xl font-bold tabular-nums">{formatCount(s.value)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
