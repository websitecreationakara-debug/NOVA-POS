import Link from "next/link";
import { getBrands, getOrdersList, getOrdersSummary } from "@/lib/supabase/queries";
import { FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import OrderStatusFilter from "@/components/OrderStatusFilter";
import OrdersTable from "@/components/OrdersTable";
import OrdersBackupButton from "@/components/OrdersBackupButton";
import { getSessionUser } from "@/lib/supabase/auth-server";
import { ppToday } from "@/lib/phnomPenhTime";
import type { FulfillmentStatus } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    page?: string;
    limit?: string;
    q?: string;
    brand?: string;
    from?: string;
    to?: string;
    range?: string;
  }>;
}) {
  const {
    status: statusParam,
    page: pageParam,
    limit: limitParam,
    q = "",
    brand = "",
    from: fromParam = "",
    to: toParam = "",
    range = "",
  } = await searchParams;
  // With no date range and no search, show only the current Cambodia month;
  // other months appear by picking a month/dates, or "All time" (?range=all).
  // A search still looks across all months.
  const allTime = range === "all";
  const defaultRange = !fromParam && !toParam && !q.trim() && !allTime;
  let from = fromParam;
  let to = toParam;
  if (defaultRange) {
    const today = ppToday();
    const [y, m] = today.split("-").map(Number);
    from = `${today.slice(0, 8)}01`;
    to = `${today.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  }
  const status = FULFILLMENT_STATUSES.includes(statusParam as FulfillmentStatus)
    ? (statusParam as FulfillmentStatus)
    : undefined;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "", 10) || 50, 1), 200);
  const page = Math.max(parseInt(pageParam ?? "", 10) || 1, 1);

  // One page of orders (filters applied in the database) -- the summary cards
  // and total badge come from separate count queries over every paid order.
  const [{ rows: orders, total }, { total: completeCount }, counts, brands, user] = await Promise.all([
    getOrdersList({ status, brandId: brand, q, from, to, page, limit }),
    // The Complete card follows the same business / date / search filters as the
    // list (but not the status tab), so it shows how many were completed in view.
    getOrdersList({ status: "complete", brandId: brand, q, from, to, page: 1, limit: 1 }),
    getOrdersSummary(),
    getBrands(),
    getSessionUser(),
  ]);
  // The CSV backup holds customer details -- Administration and Cooperate Admin only.
  const canBackup = user?.role === "admin" || user?.role === "accountance";

  const summary: { label: string; value: number; href: string }[] = [
    { label: "New today", value: counts.newToday, href: "/orders?status=new_order" },
    { label: "Pre-Order", value: counts.preOrders, href: "/orders?status=pre_order" },
    { label: "Awaiting delivery", value: counts.inProgress, href: "/orders?status=processing" },
    { label: "Complete", value: completeCount, href: "/orders?status=complete" },
  ];

  return (
    <main className="flex flex-col lg:h-full">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-black/[.08] px-3 py-3 sm:px-6 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold">Orders</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground">
          {counts.total} total
        </span>
        <span className="text-sm text-muted-foreground">
          Orders staff prepare for pickup/delivery
        </span>
        {canBackup && (
          <div className="ml-auto">
            <OrdersBackupButton />
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 px-3 pt-4 sm:gap-3 sm:px-6 lg:grid-cols-4">
        {summary.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:border-foreground/20 sm:px-4 sm:py-3"
          >
            <p className="text-[11px] leading-tight font-medium tracking-wide text-muted-foreground uppercase sm:text-xs">
              {s.label}
            </p>
            <p className="font-display mt-0.5 text-2xl font-bold tabular-nums">{s.value}</p>
          </Link>
        ))}
      </div>

      <OrderStatusFilter active={status ?? null} />

      <OrdersTable
        orders={orders}
        total={total}
        page={page}
        limit={limit}
        filters={{ q, brandId: brand, from, to }}
        defaultRange={defaultRange}
        allTime={allTime}
        currentMonth={ppToday().slice(0, 7)}
        activeStatus={status ?? null}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      />
    </main>
  );
}
