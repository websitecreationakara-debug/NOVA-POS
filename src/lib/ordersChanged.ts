"use client";

// Fired whenever an order is mutated from the client (deleted, status changed,
// bulk-updated). Components that show derived order data -- e.g. the delivery
// alert bell -- listen for it so they refresh immediately instead of waiting
// for their next poll.
export const ORDERS_CHANGED = "nova:orders-changed";

export function notifyOrdersChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ORDERS_CHANGED));
  }
}
