import { supabaseAdmin } from "@/lib/supabase/server";
import type { BackupItem, BackupOrder, OrdersRange } from "@/lib/ordersCsv";
import { ppDayEnd, ppDayStart } from "@/lib/phnomPenhTime";

// Every order (all statuses) and every order line, read in pages of 1000 (the
// database caps a single query) so a long history is complete rather than
// silently cut off. Shared by the in-app Backup buttons and the Drive backup.
// With a range, only the lines of orders dated in it are read (every order is still read: invoice
// numbers depend on the whole month, see buildOrdersCsv).
// `withItems: false` leaves the lines unread (an orders-only file).
export async function fetchOrdersBackupData(range?: OrdersRange, withItems = true): Promise<{ orders: BackupOrder[]; items: BackupItem[] }> {
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
  for (let from = 0; withItems; from += PAGE) {
    // "*" so a column a project hasn't migrated yet (e.g. size_label) just reads blank.
    let query = supabaseAdmin
      .from("order_items")
      .select(range?.from || range?.to ? "*, products(name), orders!inner(list_at)" : "*, products(name)")
      .order("order_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (range?.from) query = query.gte("orders.list_at", ppDayStart(range.from));
    if (range?.to) query = query.lte("orders.list_at", ppDayEnd(range.to));
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    items.push(...((data ?? []) as unknown as BackupItem[]));
    if (!data || data.length < PAGE) break;
  }
  return { orders, items };
}
