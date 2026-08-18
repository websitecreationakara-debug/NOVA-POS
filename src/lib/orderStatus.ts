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

export const STATUS_STYLES: Record<FulfillmentStatus, string> = {
  new_order: "bg-blue-100 text-blue-700",
  processing: "bg-amber-100 text-amber-700",
  delivered: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
  complete: "bg-green-100 text-green-700",
};
