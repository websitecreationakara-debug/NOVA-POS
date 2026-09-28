// Single source of truth for order_source values -- imported by checkout
// (SalesClient), order editing, and invoice printing (InvoiceDoc), instead of
// each keeping its own hardcoded list or label map. Only meaningful for
// channel="pos" orders (see migration 0037) -- "online" orders keep using
// channel/site to show which storefront they came from.
export type OrderSource = "in_store" | "telegram" | "meta";

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  in_store: "In-Store (POS)",
  telegram: "Telegram",
  meta: "Meta",
};

// Selectable at the POS checkout.
export const CHECKOUT_ORDER_SOURCES: OrderSource[] = ["in_store", "telegram", "meta"];
