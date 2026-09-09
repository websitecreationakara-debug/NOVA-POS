import type { FulfillmentStatus } from "@/types/database";

export const FULFILLMENT_STATUSES: FulfillmentStatus[] = [
  "new_order",
  "processing",
  "delivered",
  "cancelled",
  "complete",
];

export const STATUS_LABELS: Record<FulfillmentStatus, string> = {
  new_order: "New Order",
  processing: "Processing",
  delivered: "Delivered",
  cancelled: "Cancel",
  complete: "Complete",
};

// Badge colours per order state. Light, opaque chips that read on either
// theme; dark-mode overrides keep them from glowing on the dark card.
export const STATUS_STYLES: Record<FulfillmentStatus, string> = {
  new_order: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  processing: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  delivered: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  cancelled: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
  complete: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

