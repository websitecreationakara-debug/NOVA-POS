import Link from "next/link";
import BackLink from "@/components/BackLink";
import { notFound } from "next/navigation";
import { getBrands, getInvoice } from "@/lib/supabase/queries";
import { supabaseAdmin } from "@/lib/supabase/server";
import OrderStatusControl from "@/components/OrderStatusControl";
import OrderEditor from "@/components/OrderEditor";
import InvoiceNumberEditor from "@/components/InvoiceNumberEditor";
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

  // Who created / last edited the invoice: one name when it is the same person, else both.
  const staffIds = [...new Set([order.created_by, order.updated_by].filter((id): id is string => !!id))];
  const { data: staffRows } = staffIds.length
    ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", staffIds)
    : { data: [] };
  const staffName = (id: string | null | undefined) =>
    id ? ((staffRows ?? []).find((s) => s.id === id)?.full_name ?? "Unknown staff") : null;
  const createdBy = staffName(order.created_by) ?? (order.channel === "online" ? "Website" : null);
  const updatedBy = staffName(order.updated_by);
  const trackLabel =
    createdBy && updatedBy
      ? createdBy === updatedBy
        ? `Created & updated by ${createdBy}`
        : `Created by ${createdBy} · Updated by ${updatedBy}`
      : createdBy
        ? `Created by ${createdBy}`
        : updatedBy
          ? `Updated by ${updatedBy}`
          : null;

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
        <BackLink href={backHref} className="text-sm text-muted-foreground hover:underline">
          {backToMargin ? "← Back to Margin Report" : backToDashboard ? "← Back to Dashboard" : "← Back to Orders"}
        </BackLink>
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
            <InvoiceNumberEditor
              orderId={order.id}
              invoiceNumber={invoiceNumber}
              isCustom={!!order.custom_invoice_number}
            />
            <p className="mt-1 text-sm text-muted-foreground">
              {order.paid_at ? new Date(order.paid_at).toLocaleString("en-US", { timeZone: "Asia/Phnom_Penh" }) : "—"}
            </p>
            {trackLabel && <p className="mt-0.5 text-xs text-muted-foreground">{trackLabel}</p>}
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
