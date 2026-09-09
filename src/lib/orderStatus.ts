import type { FulfillmentStatus } from "@/types/database";

export const FULFILLMENT_STATUSES: FulfillmentStatus[] = [
  "pre_order",
  "new_order",
  "processing",
  "delivered",
  "cancelled",
  "complete",
];

export const STATUS_LABELS: Record<FulfillmentStatus, string> = {
  pre_order: "Pre-Order",
  new_order: "New Order",
  processing: "Processing",
  delivered: "Delivered",
  cancelled: "Cancel",
  complete: "Complete",
};

// Badge colours per order state. Light, opaque chips that read on either
// theme; dark-mode overrides keep them from glowing on the dark card.
export const STATUS_STYLES: Record<FulfillmentStatus, string> = {
  pre_order: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  new_order: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  processing: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  delivered: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  complete: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};
