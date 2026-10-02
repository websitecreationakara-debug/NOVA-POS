import Link from "next/link";
import { getBrands, getOrdersList, getOrdersSummary } from "@/lib/supabase/queries";
import { FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import OrderStatusFilter from "@/components/OrderStatusFilter";
import OrdersTable from "@/components/OrdersTable";
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
  }>;
}) {
  const { status: statusParam, page: pageParam, limit: limitParam, q = "", brand = "", from = "", to = "" } =
    await searchParams;
  const status = FULFILLMENT_STATUSES.includes(statusParam as FulfillmentStatus)
    ? (statusParam as FulfillmentStatus)
    : undefined;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "", 10) || 50, 1), 200);
  const page = Math.max(parseInt(pageParam ?? "", 10) || 1, 1);

  // One page of orders (filters applied in the database) -- the summary cards
  // and total badge come from separate count queries over every paid order.
  const [{ rows: orders, total }, counts, brands] = await Promise.all([
    getOrdersList({ status, brandId: brand, q, from, to, page, limit }),
    getOrdersSummary(),
    getBrands(),
  ]);

  const summary: { label: string; value: number; href: string }[] = [
    { label: "New today", value: counts.newToday, href: "/orders?status=new_order" },
    { label: "Awaiting delivery", value: counts.inProgress, href: "/orders?status=processing" },
    { label: "Delivered", value: counts.delivered, href: "/orders?status=delivered" },
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
      </header>

      <div className="grid grid-cols-3 gap-2 px-3 pt-4 sm:gap-3 sm:px-6">
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
        activeStatus={status ?? null}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
      />
    </main>
  );
}
