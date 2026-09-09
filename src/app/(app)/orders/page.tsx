import Link from "next/link";
import { getOrdersList } from "@/lib/supabase/queries";
import { FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import OrderStatusFilter from "@/components/OrderStatusFilter";
import OrdersTable from "@/components/OrdersTable";
import type { FulfillmentStatus } from "@/types/database";

export const dynamic = "force-dynamic";

function todayLocal() {
  return new Date().toLocaleDateString("en-CA");
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const status = FULFILLMENT_STATUSES.includes(statusParam as FulfillmentStatus)
    ? (statusParam as FulfillmentStatus)
    : undefined;

  // Always load the full list -- the status filter is applied client-side so
  // the summary cards and bulk selection see every order.
  const orders = await getOrdersList();

  const today = todayLocal();
  const newToday = orders.filter(
    (o) =>
      o.fulfillmentStatus === "new_order" &&
      o.paidAt &&
      new Date(o.paidAt).toLocaleDateString("en-CA") === today
  ).length;
  const inProgress = orders.filter(
    (o) => o.fulfillmentStatus === "new_order" || o.fulfillmentStatus === "processing"
  ).length;
  const delivered = orders.filter(
    (o) => o.fulfillmentStatus === "delivered" || o.fulfillmentStatus === "complete"
  ).length;

  const summary: { label: string; value: number; href: string }[] = [
    { label: "New today", value: newToday, href: "/orders?status=new_order" },
    { label: "Awaiting delivery", value: inProgress, href: "/orders?status=processing" },
    { label: "Delivered", value: delivered, href: "/orders?status=delivered" },
  ];

  return (
    <main className="flex h-full flex-col">
      <header className="flex items-baseline gap-3 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold">Orders</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {orders.length} total
        </span>
        <span className="text-sm text-muted-foreground">
          Orders staff prepare for pickup/delivery
        </span>
      </header>

      <div className="grid grid-cols-3 gap-3 px-6 pt-4">
        {summary.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/20"
          >
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {s.label}
            </p>
            <p className="font-display mt-0.5 text-2xl font-bold tabular-nums">{s.value}</p>
          </Link>
        ))}
      </div>

      <OrderStatusFilter active={status ?? null} />

      <OrdersTable orders={orders} activeStatus={status ?? null} />
    </main>
  );
}
