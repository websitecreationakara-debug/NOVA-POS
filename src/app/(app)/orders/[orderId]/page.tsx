import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrands, getInvoice } from "@/lib/supabase/queries";
import OrderStatusControl from "@/components/OrderStatusControl";
import OrderEditor from "@/components/OrderEditor";
import DeleteOrderButton from "@/components/DeleteOrderButton";

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { orderId } = await params;
  const { back } = await searchParams;
  // Opened from a Margin Report product page or the Dashboard's Recent Orders? Then
  // "back" goes there instead of the Orders list. Only Accounting pages and the
  // Dashboard (with its filters, and its #recent-orders spot) are accepted.
  const safeBack = back && !back.startsWith("//") ? back : null;
  const backToMargin = safeBack?.startsWith("/accountance") ? safeBack : null;
  const backToDashboard =
    safeBack === "/" || safeBack?.startsWith("/?") || safeBack?.startsWith("/#") ? safeBack : null;
  const backHref = backToMargin ?? backToDashboard ?? "/orders";
  const [invoice, brands] = await Promise.all([getInvoice(orderId), getBrands()]);

  if (!invoice) notFound();

  const { order, invoiceNumber, customerAddress, items } = invoice;

  const deliveryLabel = order.delivery_at
    ? new Date(order.delivery_at).toLocaleString("en-US", {
        // Phnom Penh time, whatever time zone the server runs in (UTC when live).
        timeZone: "Asia/Phnom_Penh",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })
    : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href={backHref} className="text-sm text-muted-foreground hover:underline">
          {backToMargin ? "← Back to Margin Report" : backToDashboard ? "← Back to Dashboard" : "← Back to Orders"}
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
              {order.paid_at ? new Date(order.paid_at).toLocaleString("en-US", { timeZone: "Asia/Phnom_Penh" }) : "—"}
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
          deliveryAt={order.delivery_at}
          paymentMethod={order.payment_method}
          discount={order.discount}
          deliveryFee={order.delivery_fee}
          note={order.note ?? ""}
          items={items.map((i) => ({
            productId: i.productId,
            name: i.name,
            unit: i.unit,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            sizeLabel: i.sizeLabel,
            nameKm: i.nameKm,
            unitKm: i.unitKm,
            weightLabel: i.weightLabel,
            imageUrl: i.imageUrl,
          }))}
        />
      </div>
    </main>
  );
}
