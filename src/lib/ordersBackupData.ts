import { supabaseAdmin } from "@/lib/supabase/server";
import type { BackupItem, BackupOrder } from "@/lib/ordersCsv";

// Every order (all statuses) and every order line, read in pages of 1000 (the
// database caps a single query) so a long history is complete rather than
// silently cut off. Shared by the in-app Backup buttons and the Drive backup.
export async function fetchOrdersBackupData(): Promise<{ orders: BackupOrder[]; items: BackupItem[] }> {
  const PAGE = 1000;
  const orders: BackupOrder[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, brands!orders_brand_id_fkey(name), customers(address)")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    orders.push(...((data ?? []) as unknown as BackupOrder[]));
    if (!data || data.length < PAGE) break;
  }

  const items: BackupItem[] = [];
  for (let from = 0; ; from += PAGE) {
    // "*" so a column a project hasn't migrated yet (e.g. size_label) just reads blank.
    const { data, error } = await supabaseAdmin
      .from("order_items")
      .select("*, products(name)")
      .order("order_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    items.push(...((data ?? []) as unknown as BackupItem[]));
    if (!data || data.length < PAGE) break;
  }
  return { orders, items };
}
