import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrands, getInvoice } from "@/lib/supabase/queries";
import OrderStatusControl from "@/components/OrderStatusControl";
import OrderEditor from "@/components/OrderEditor";
import DeleteOrderButton from "@/components/DeleteOrderButton";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const [invoice, brands] = await Promise.all([getInvoice(orderId), getBrands()]);

  if (!invoice) notFound();

  const { order, invoiceNumber, customerAddress, items } = invoice;

  const deliveryLabel = order.delivery_at
    ? new Date(order.delivery_at).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/orders" className="text-sm text-muted-foreground hover:underline">
          ← Back to Orders
        </Link>
        <div className="flex items-center gap-4">
          <Link href={`/invoice/${order.id}`} className="text-sm text-brand hover:underline">
            View printable invoice →
          </Link>
          <DeleteOrderButton orderId={order.id} redirectTo="/orders" />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-semibold">
              {invoiceNumber}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.paid_at ? new Date(order.paid_at).toLocaleString() : "—"}
            </p>
          </div>
          <OrderStatusControl orderId={order.id} status={order.fulfillment_status} />
        </div>

        <OrderEditor
          orderId={order.id}
          brands={brands.map((b) => ({ id: b.id, name: b.name }))}
          brandId={order.brand_id}
          customerName={order.customer_name ?? ""}
          customerPhone={order.customer_phone ?? ""}
          customerAddress={customerAddress ?? ""}
          deliveryLabel={deliveryLabel}
          discount={order.discount}
          deliveryFee={order.delivery_fee}
          note={order.note ?? ""}
          items={items.map((i) => ({
            productId: i.productId,
            name: i.name,
            unit: i.unit,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          }))}
        />
      </div>
    </main>
  );
}
