"use server";

import { requireStockAccess } from "@/lib/stockAccess";
import { clearReorderCache } from "./data";

// The Refresh button on Reorder Suggestions: forget the kept figures of a business, so the page works them out again.
export async function refreshReorderAction(brandId: string): Promise<void> {
  await requireStockAccess();
  clearReorderCache(brandId);
}
