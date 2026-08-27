import { supabaseAdmin } from "@/lib/supabase/server";
import type {
  Brand,
  CashReconciliation,
  Category,
  Expense,
  FulfillmentStatus,
  Order,
  Product,
} from "@/types/database";

export type ProductWithStock = Product & {
  stock_quantity: number;
  low_stock_threshold: number;
  site_link: { site: string; site_product_id: string } | null;
};

// Sales/Stock fall back to brands[0] as the default brand when no ?brand= is
// given -- Bosba Premium Foods is the primary business, so it goes first
// regardless of alphabetical order (which would otherwise put BOSBA
// Drink&Snack first).
export const DEFAULT_BRAND_SLUG = "bosba-premium-foods";

export async function getBrands(): Promise<Brand[]> {
  const { data, error } = await supabaseAdmin.from("brands").select("*").order("name");
  if (error) throw error;
  const brands = data ?? [];
  return brands.toSorted((a, b) =>
    a.slug === DEFAULT_BRAND_SLUG ? -1 : b.slug === DEFAULT_BRAND_SLUG ? 1 : 0
  );
}

type ProductRow = Product & {
  stock_levels: { quantity: number; low_stock_threshold: number } | null;
  product_site_links: { site: string; site_product_id: string }[];
};

function mapProductRows(products: ProductRow[]): ProductWithStock[] {
  return products.map((p) => {
    const { stock_levels, product_site_links, ...product } = p;
    return {
      ...product,
      stock_quantity: stock_levels?.quantity ?? 0,
      low_stock_threshold: stock_levels?.low_stock_threshold ?? 0,
      site_link: product_site_links?.[0] ?? null,
    };
  });
}

export async function getCatalogForBrand(brandId: string): Promise<{
  categories: Category[];
  products: ProductWithStock[];
}> {
  const [{ data: categories, error: catError }, { data: products, error: prodError }] =
    await Promise.all([
      supabaseAdmin
        .from("categories")
        .select("*")
        .eq("brand_id", brandId)
        .order("sort_order"),
      // Embed stock_levels via its FK to products instead of a second
      // query with .in(productIds) -- that broke once a brand's catalog
      // grew past a few hundred products (URL length limit on the GET).
      supabaseAdmin
        .from("products")
        .select("*, stock_levels(quantity, low_stock_threshold), product_site_links(site, site_product_id)")
        .eq("brand_id", brandId)
        .eq("is_active", true)
        .order("name"),
    ]);

  if (catError) throw catError;
  if (prodError) throw prodError;

  return { categories: categories ?? [], products: mapProductRows((products ?? []) as ProductRow[]) };
}

// Same as getCatalogForBrand, but filters by the brand's slug via an embedded
// join instead of its id -- lets the default-brand page load (no ?brand= in
// the URL, e.g. clicking Sales/Stock in the sidebar) start this fetch
// immediately in parallel with getBrands(), instead of waiting on getBrands()
// first just to resolve which id "the default brand" even is.
export async function getCatalogForBrandSlug(slug: string): Promise<{
  categories: Category[];
  products: ProductWithStock[];
}> {
  const [{ data: categories, error: catError }, { data: products, error: prodError }] =
    await Promise.all([
      supabaseAdmin
        .from("categories")
        .select("*, brands!inner(slug)")
        .eq("brands.slug", slug)
        .order("sort_order"),
      supabaseAdmin
        .from("products")
        .select(
          "*, stock_levels(quantity, low_stock_threshold), product_site_links(site, site_product_id), brands!inner(slug)"
        )
        .eq("brands.slug", slug)
        .eq("is_active", true)
        .order("name"),
    ]);

  if (catError) throw catError;
  if (prodError) throw prodError;

  const cleanCategories = (categories ?? []).map(({ brands: _brands, ...c }) => c) as Category[];
  const cleanProducts = ((products ?? []) as (ProductRow & { brands: { slug: string } })[]).map(
    ({ brands: _brands, ...p }) => p as ProductRow
  );

  return { categories: cleanCategories, products: mapProductRows(cleanProducts) };
}

export type DailySalesSummary = {
  cashTotal: number;
  bankQrTotal: number;
  orderCount: number;
  total: number;
};

export async function getDailySales(
  brandId: string,
  date: string
): Promise<{ summary: DailySalesSummary; orders: Order[] }> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("brand_id", brandId)
    .eq("status", "paid")
    .gte("paid_at", `${date}T00:00:00.000Z`)
    .lte("paid_at", `${date}T23:59:59.999Z`)
    .order("paid_at", { ascending: false });

  if (error) throw error;
  const orders = data ?? [];
  const cashTotal = orders
    .filter((o) => o.payment_method === "cash")
    .reduce((sum, o) => sum + o.total, 0);
  const bankQrTotal = orders
    .filter((o) => o.payment_method === "bank_qr")
    .reduce((sum, o) => sum + o.total, 0);

  return {
    summary: { cashTotal, bankQrTotal, orderCount: orders.length, total: cashTotal + bankQrTotal },
    orders,
  };
}

export async function getReconciliation(
  brandId: string,
  date: string
): Promise<CashReconciliation | null> {
  const { data, error } = await supabaseAdmin
    .from("cash_reconciliations")
    .select("*")
    .eq("brand_id", brandId)
    .eq("reconciliation_date", date)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export type DashboardStats = {
  totalRevenue: number;
  ordersToday: number;
  totalProducts: number;
  lowStockCount: number;
  last7Days: { day: string; total: number }[];
  recentOrders: {
    id: string;
    brandName: string;
    status: string;
    total: number;
    paidAt: string | null;
  }[];
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: paidOrders, error: ordersError },
    { count: totalProducts, error: prodError },
    { data: stockRows, error: stockError },
    { data: recentOrdersData, error: recentError },
  ] = await Promise.all([
    supabaseAdmin.from("orders").select("total, paid_at").eq("status", "paid"),
    supabaseAdmin.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabaseAdmin
      .from("stock_levels")
      .select("quantity, low_stock_threshold, products!inner(is_active)")
      .eq("products.is_active", true)
      .gt("low_stock_threshold", 0),
    supabaseAdmin
      .from("orders")
      .select("id, status, total, paid_at, brands(name)")
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(5),
  ]);

  if (ordersError) throw ordersError;
  if (prodError) throw prodError;
  if (stockError) throw stockError;
  if (recentError) throw recentError;

  const orders = paidOrders ?? [];
  const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
  const ordersToday = orders.filter((o) => (o.paid_at ?? "").slice(0, 10) === today).length;
  const lowStockCount = (stockRows ?? []).filter((s) => s.quantity <= s.low_stock_threshold).length;

  const dayBuckets = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dayBuckets.set(d, 0);
  }
  for (const o of orders) {
    const d = (o.paid_at ?? "").slice(0, 10);
    if (dayBuckets.has(d)) {
      dayBuckets.set(d, (dayBuckets.get(d) ?? 0) + o.total);
    }
  }
  const last7Days = Array.from(dayBuckets.entries()).map(([day, total]) => ({ day, total }));

  type RecentOrderRow = {
    id: string;
    status: string;
    total: number;
    paid_at: string | null;
    brands: { name: string } | null;
  };
  const recentOrders = ((recentOrdersData ?? []) as RecentOrderRow[]).map((o) => ({
    id: o.id,
    brandName: o.brands?.name ?? "—",
    status: o.status,
    total: o.total,
    paidAt: o.paid_at,
  }));

  return {
    totalRevenue,
    ordersToday,
    totalProducts: totalProducts ?? 0,
    lowStockCount,
    last7Days,
    recentOrders,
  };
}

export type OrderListRow = {
  id: string;
  invoiceNumber: string | null;
  brandName: string;
  customerName: string | null;
  customerPhone: string | null;
  total: number;
  fulfillmentStatus: FulfillmentStatus;
  paidAt: string | null;
};

export async function getOrdersList(status?: FulfillmentStatus): Promise<OrderListRow[]> {
  let query = supabaseAdmin
    .from("orders")
    .select("id, invoice_number, customer_name, customer_phone, total, fulfillment_status, paid_at, brands(name)")
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(200);

  if (status) {
    query = query.eq("fulfillment_status", status);
  }

  const { data, error } = await query;
  if (error) throw error;

  type Row = {
    id: string;
    invoice_number: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    total: number;
    fulfillment_status: FulfillmentStatus;
    paid_at: string | null;
    brands: { name: string } | null;
  };

  return ((data ?? []) as Row[]).map((o) => ({
    id: o.id,
    invoiceNumber: o.invoice_number,
    brandName: o.brands?.name ?? "—",
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    total: o.total,
    fulfillmentStatus: o.fulfillment_status,
    paidAt: o.paid_at,
  }));
}

export type InvoiceData = {
  order: Order;
  brandName: string;
  brandLogoUrl: string | null;
  customerAddress: string | null;
  items: { name: string; unit: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

export async function getInvoice(orderId: string): Promise<InvoiceData | null> {
  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*, brands(name, logo_url), customers(address)")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return null;

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("order_items")
    .select("quantity, unit_price, line_total, products(name, unit)")
    .eq("order_id", orderId);

  if (itemsError) throw itemsError;

  type ItemRow = {
    quantity: number;
    unit_price: number;
    line_total: number;
    products: { name: string; unit: string } | null;
  };
  const { brands, customers, ...orderFields } = order as Order & {
    brands: { name: string; logo_url: string | null } | null;
    customers: { address: string | null } | null;
  };

  return {
    order: orderFields,
    brandName: brands?.name ?? "—",
    brandLogoUrl: brands?.logo_url ?? null,
    customerAddress: customers?.address ?? null,
    items: ((items ?? []) as ItemRow[]).map((i) => ({
      name: i.products?.name ?? "—",
      unit: i.products?.unit ?? "",
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
    })),
  };
}

export async function getExpensesForDate(brandId: string, date: string): Promise<Expense[]> {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select("*")
    .eq("brand_id", brandId)
    .eq("expense_date", date)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
