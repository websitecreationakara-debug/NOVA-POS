"use client";

// Fired the moment a sale finishes charging (see SalesClient's handleCharge).
// The delivery/alerts bell listens for this so it can show the sale and chime
// immediately instead of waiting on its next poll -- this is local to the
// browser tab that charged it, not a cross-device broadcast.
export const SALE_CHARGED = "nova:sale-charged";

export type SaleChargedDetail = {
  orderId: string;
  amount: number;
  customerName: string | null;
  invoiceNumber: string | null;
};

export function notifySaleCharged(detail: SaleChargedDetail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SaleChargedDetail>(SALE_CHARGED, { detail }));
  }
}
