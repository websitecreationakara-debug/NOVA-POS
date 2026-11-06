// Single source of truth for order_source values -- imported by checkout
// (SalesClient), order editing, and invoice printing (InvoiceDoc), instead of
// each keeping its own hardcoded list or label map. Only meaningful for
// channel="pos" orders (see migration 0037) -- "online" orders keep using
// channel/site to show which storefront they came from.
export type OrderSource = "in_store" | "telegram" | "meta" | "tiktok" | "pickup";

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  in_store: "In-Store (POS)",
  telegram: "Telegram",
  meta: "Meta",
  tiktok: "TikTok",
  pickup: "Pick up",
};

// Selectable at the POS checkout -- "in_store" isn't a button here, it's the
// implicit default every sale already starts as; staff only need to flag the
// exceptional cases (an order that actually came in over Telegram, Meta or TikTok,
// or that the customer picks up).
export const CHECKOUT_ORDER_SOURCES: OrderSource[] = ["telegram", "meta", "tiktok", "pickup"];
