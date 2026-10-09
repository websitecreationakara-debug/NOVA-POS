"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import type { Customer, DiscountType, Promotion } from "@/types/database";
import type { CustomerImportRow } from "@/lib/customerCsv";
import { NO_CUSTOMER_FILTERS, type CustomerBuying, type CustomerFilters } from "@/lib/customerFilters";
import { formatInvoiceNumber, invoiceMonthStartIso } from "@/lib/invoiceNumber";
import { getBrands } from "@/lib/supabase/queries";
import { ppDay, ppDayEnd, ppDayStart, ppToday } from "@/lib/phnomPenhTime";
import { COUNTED_FULFILLMENT_STATUSES } from "@/lib/orderStatus";
import {
  MONTH_NAMES,
  buildMonthlyTable,
  buildProductInsight,
  insightBounds,
  insightFromSummary,
  type InsightLine,
  type InsightSummary,
  type InsightRange,
  type MonthlyRow,
  type ProductInsight,
} from "@/lib/productInsight";
import { buildXlsx, type XlsxCell, type XlsxColumn } from "@/lib/xlsxWriter";
import { tally } from "@/lib/crmCharts";
import { readAllPages } from "@/lib/supabase/readAllPages";
import {
  buildPeriod,
  normalizeAnchor,
  parseCompareAnchors,
  parseGranularity,
  periodRange,
  type CrmChartsResult,
  type CustomerRow,
  type PeriodOrder,
} from "@/lib/crmPeriods";

export async function requireMarketingAccess() {
  // Defense in depth: /marketing is already role-gated in proxy.ts, but
  // Server Actions are their own endpoint and reachable independent of
  // which page rendered them, so re-check here rather than trust the route.
  const caller = await getSessionUser();
  if (caller?.role !== "admin" && caller?.role !== "marketing" && caller?.role !== "accountance") {
    throw new Error("Only admin, marketing or Cooperate Admin staff can manage promotions and customers");
  }
}

// The CRM customer list: everyone who manages marketing, plus Sale Customer
// Support (role "sales"), who can look customers up and edit them but not
// delete / import them or touch promotions and Cost Control.
async function requireCrmAccess() {
  const caller = await getSessionUser();
  if (caller?.role !== "sales") await requireMarketingAccess();
}

// Everything the CRM Charts page shows, for one period (a day, week, month, year
// or all time) and optionally up to five more of the same kind to compare it
// with, optionally for one province. Customers are read once, in parallel pages of 1000 (the
// database's per-request cap); each period's orders are read separately. An
// order is matched to its customer by link or by phone (see buildPeriod), and
// orders that were cancelled or voided are left out -- the same rule as the CRM
// list's "Bought on" filter.
export async function getCrmChartDataAction(input: {
  gran: string;
  anchor?: string;
  compare?: string;
  province?: string;
}): Promise<CrmChartsResult> {
  await requireCrmAccess();

  const today = ppToday();
  const gran = parseGranularity(input.gran);
  const anchorA = normalizeAnchor(gran, input.anchor, today);
  const anchors = [anchorA, ...parseCompareAnchors(gran, input.compare, anchorA, today)];

  type Row = {
    id: string;
    name: string;
    phone: string | null;
    second_phone: string | null;
    state: string | null;
    gender: string | null;
    age: string | null;
    nationality: string | null;
    capital: string | null;
    customer_since: string | null;
    created_at: string;
  };
  // The customers and every period's orders are independent, so read them all at
  // the same time instead of one after another.
  const [customerRows, orderSets] = await Promise.all([
    readAllPages<Row>((withCount) =>
      supabaseAdmin
        .from("customers")
        .select("id, name, phone, second_phone, state, gender, age, nationality, capital, customer_since, created_at", {
          count: withCount ? "exact" : undefined,
        })
        .order("id")
    ),
    Promise.all(
      anchors.map((anchor) => {
        const { from, to } = periodRange(gran, anchor, today);
        return fetchPeriodOrders(from, to);
      })
    ),
  ]);
  const customers: CustomerRow[] = [];
  for (const r of customerRows) {
    customers.push({
      id: r.id,
      name: r.name,
      phone: r.phone,
      second_phone: r.second_phone,
      state: r.state,
      gender: r.gender,
      age: r.age,
      nationality: r.nationality,
      capital: r.capital,
      // A customer added at checkout has no customer-since date, so their
      // creation date stands in for it.
      since: r.customer_since ?? ppDay(r.created_at),
    });
  }

  // A province that isn't one of the customers' provinces is ignored.
  const provinces = tally(customers.map((c) => c.state)).filter((s) => s.name !== "Unknown");
  const province = provinces.some((p) => p.name === input.province) ? (input.province as string) : "";

  const firstYear = Number(
    customers.reduce((min, c) => (c.since < min ? c.since : min), today).slice(0, 4)
  );
  const thisYear = Number(today.slice(0, 4));
  // The year picker goes back at least 15 years -- further if the data does -- so
  // a year can be compared even where there are no records yet (it just shows 0).
  const lastYear = Math.min(firstYear, thisYear - 14);
  return {
    gran,
    anchors,
    province,
    provinces,
    totalCustomers: customers.length,
    years: Array.from({ length: thisYear - lastYear + 1 }, (_, i) => thisYear - i),
    periods: anchors.map((anchor, i) =>
      buildPeriod({ gran, anchor, today, customers, orders: orderSets[i], province })
    ),
  };
}

// The orders of a period (Phnom Penh days, inclusive; `from` null = from the
// start) that count as a customer having bought: not cancelled, not voided. Dated
// by the day the Orders list files them under.
async function fetchPeriodOrders(from: string | null, to: string): Promise<PeriodOrder[]> {
  type Row = {
    id: string;
    customer_id: string | null;
    customer_phone: string | null;
    subtotal: number;
    list_at: string | null;
    paid_at: string | null;
  };
  const rows = await readAllPages<Row>((withCount) => {
    let q = supabaseAdmin
      .from("orders")
      .select("id, customer_id, customer_phone, subtotal, list_at, paid_at", { count: withCount ? "exact" : undefined })
      .neq("status", "voided")
      .neq("fulfillment_status", "cancelled")
      .lte("list_at", ppDayEnd(to));
    if (from) q = q.gte("list_at", ppDayStart(from));
    return q.order("id");
  });
  return rows.flatMap((r) => {
    const at = r.list_at ?? r.paid_at;
    if (!at) return [];
    return [
      {
        id: r.id,
        customerId: r.customer_id,
        phone: r.customer_phone,
        subtotal: Number(r.subtotal),
        day: ppDay(at),
        // Phnom Penh is UTC+7 all year.
        hour: new Date(new Date(at).getTime() + 7 * 3600e3).getUTCHours(),
      },
    ];
  });
}

// The sold lines for Product Insight: every line of an order that counts towards
// money (paid, Processing / Delivered / Complete) dated between `from` and `to`
// (Phnom Penh days; `from` null = from the start), optionally one business (by
// the product's own business). Dated by the day the Orders list files the order
// under. Read in parallel pages of 1000 (the database's per-request cap).
async function fetchInsightLines(from: string | null, to: string, brandId: string): Promise<InsightLine[]> {
  const makeQuery = () => {
    let q = supabaseAdmin
      .from("order_items")
      .select(
        "order_id, product_id, quantity, line_total, products!inner(name, unit, unit_km, brand_id, categories(name)), orders!inner(list_at, paid_at)",
        { count: "exact" }
      )
      .eq("orders.status", "paid")
      .in("orders.fulfillment_status", COUNTED_FULFILLMENT_STATUSES)
      .lte("orders.list_at", ppDayEnd(to));
    if (from) q = q.gte("orders.list_at", ppDayStart(from));
    if (brandId) q = q.eq("products.brand_id", brandId);
    return q.order("id");
  };

  type Row = {
    order_id: string;
    product_id: string;
    quantity: number;
    line_total: number;
    products: {
      name: string;
      unit: string | null;
      unit_km: string | null;
      brand_id: string;
      categories: { name: string } | null;
    };
    orders: { list_at: string | null; paid_at: string | null };
  };
  const first = await makeQuery().range(0, 999);
  if (first.error) throw new Error(first.error.message);
  const rows: Row[] = [...((first.data ?? []) as unknown as Row[])];
  const pageCount = Math.ceil((first.count ?? 0) / 1000);
  // The remaining pages, a few at a time.
  for (let i = 1; i < pageCount; i += 6) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(6, pageCount - i) }, (_, k) =>
        makeQuery().range((i + k) * 1000, (i + k) * 1000 + 999)
      )
    );
    for (const page of batch) {
      if (page.error) throw new Error(page.error.message);
      rows.push(...((page.data ?? []) as unknown as Row[]));
    }
  }

  return rows.map((r) => ({
    orderId: r.order_id,
    productId: r.product_id,
    name: r.products.name,
    brandId: r.products.brand_id,
    category: r.products.categories?.name ?? null,
    quantity: Number(r.quantity),
    total: Number(r.line_total),
    unit: r.products.unit_km?.trim() || r.products.unit?.trim() || "",
    day: ppDay(r.orders.list_at ?? r.orders.paid_at),
  }));
}

// Everything the Product Insight overview shows, for a period and optionally one
// business.
export async function getProductInsightAction(
  range: InsightRange,
  brandId: string,
  custom?: { from?: string; to?: string }
): Promise<{ insight: ProductInsight; from: string | null; to: string }> {
  await requireMarketingAccess();

  const bounds = insightBounds(range, ppToday(), custom);

  // Added up in the database (migration 0070), so only the summary comes back
  // instead of every sold line.
  const { data, error } = await supabaseAdmin.rpc("product_insight", {
    p_from: bounds.from,
    p_to: bounds.to,
    p_brand: brandId || null,
  });
  if (!error && data) {
    return { insight: insightFromSummary(data as unknown as InsightSummary, bounds), from: bounds.from, to: bounds.to };
  }
  // Migration 0070 not applied yet: read the lines and add them up here (slower).
  if (error && error.code !== "PGRST202") throw new Error(error.message);

  const lines = await fetchInsightLines(bounds.from, bounds.to, brandId);
  const brandNames = new Map((await getBrands()).map((b) => [b.id, b.name]));
  return { insight: buildProductInsight(lines, bounds, brandNames), from: bounds.from, to: bounds.to };
}

// "Insight by Quantity" / "Insight by Price": each product's quantity sold and
// sales for every month of one year. `years` lists the years that have orders
// (newest first) for the year picker.
export async function getProductMonthlyAction(
  year: number,
  brandId: string
): Promise<{ rows: MonthlyRow[]; year: number; years: number[] }> {
  await requireMarketingAccess();

  const thisYear = Number(ppToday().slice(0, 4));
  const y = Number.isInteger(year) && year >= 2000 && year <= thisYear ? year : thisYear;
  // Added up in the database (migration 0072); if that isn't applied yet, read the
  // year's lines and add them up here (slower).
  const [monthly, earliest] = await Promise.all([
    supabaseAdmin.rpc("product_monthly", { p_year: y, p_brand: brandId || null }),
    supabaseAdmin
      .from("orders")
      .select("list_at")
      .eq("status", "paid")
      .not("list_at", "is", null)
      .order("list_at", { ascending: true })
      .limit(1),
  ]);
  let rows: MonthlyRow[];
  if (!monthly.error && monthly.data) {
    rows = (monthly.data as unknown as MonthlyRow[])
      .map((r) => ({ ...r, qty: r.qty.map(Number), amount: r.amount.map(Number) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } else {
    if (monthly.error && monthly.error.code !== "PGRST202") throw new Error(monthly.error.message);
    rows = buildMonthlyTable(await fetchInsightLines(`${y}-01-01`, `${y}-12-31`, brandId));
  }
  const firstYear = Number((earliest.data?.[0]?.list_at ?? `${thisYear}`).slice(0, 4)) || thisYear;
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i);
  return { rows, year: y, years };
}

// The monthly table as an Excel file. The rows come from the screen (already
// loaded), so nothing is read again; only the layout is built here.
export async function exportProductMonthlyAction(input: {
  view: "quantity" | "price";
  year: number;
  businessLabel: string;
  rows: MonthlyRow[];
}): Promise<{ filename: string; mime: string; base64: string }> {
  await requireMarketingAccess();

  const isPrice = input.view === "price";
  const columns: XlsxColumn[] = [
    { header: "English Name", width: 44, kind: "text" },
    { header: "Scale", width: 14, kind: "text" },
    ...MONTH_NAMES.map((m) => ({ header: m, width: 11, kind: isPrice ? ("money" as const) : ("number" as const) })),
    { header: isPrice ? "Sum Price" : "Sum QTY", width: 13, kind: isPrice ? "money" : "number" },
  ];
  const values = (r: MonthlyRow) => (isPrice ? r.amount : r.qty);
  const rows: XlsxCell[][] = input.rows.map((r) => {
    const v = values(r);
    return [r.name, r.unit, ...v, Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100];
  });
  const stem = `product-insight-by-${input.view}-${input.year}${input.businessLabel ? `-${input.businessLabel.replace(/[^\w]+/g, "-")}` : ""}`;
  return {
    filename: `${stem}.xlsx`,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: buildXlsx(isPrice ? "Insight by Price" : "Insight by Quantity", columns, rows).toString("base64"),
  };
}

export async function listPromotionsAction(brandId?: string): Promise<Promotion[]> {
  await requireMarketingAccess();

  let query = supabaseAdmin.from("promotions").select("*").order("created_at", { ascending: false });
  // A promotion with brand_id = null applies to every brand, so it stays
  // in the list regardless of which brand is selected in the filter.
  if (brandId) {
    query = query.or(`brand_id.eq.${brandId},brand_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createPromotionAction(input: {
  code: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  brandId?: string;
  startsAt?: string;
  endsAt?: string;
}): Promise<void> {
  await requireMarketingAccess();

  const code = input.code.trim().toUpperCase();
  if (!code) throw new Error("Code is required");
  if (Number.isNaN(input.discountValue) || input.discountValue < 0) {
    throw new Error("Discount value must be a positive number");
  }

  const { error } = await supabaseAdmin.from("promotions").insert({
    code,
    description: input.description?.trim() || null,
    discount_type: input.discountType,
    discount_value: input.discountValue,
    brand_id: input.brandId || null,
    starts_at: input.startsAt || null,
    ends_at: input.endsAt || null,
    is_active: true,
  });

  if (error) {
    if (error.code === "23505") throw new Error(`Code "${code}" is already in use`);
    throw new Error(error.message);
  }

  revalidatePath("/marketing");
}

export async function setPromotionActiveAction(id: string, isActive: boolean): Promise<void> {
  await requireMarketingAccess();

  const { error } = await supabaseAdmin.from("promotions").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/marketing");
}

export async function deletePromotionAction(id: string): Promise<void> {
  await requireMarketingAccess();

  const { error } = await supabaseAdmin.from("promotions").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/marketing");
}

// The State / Age / Gender dropdown choices (with how many customers each),
// for the CRM filter bar. Empty if migration 0064 isn't applied yet.
export async function listCustomerFilterOptionsAction(): Promise<{
  states: { value: string; n: number }[];
  ages: { value: string; n: number }[];
  genders: { value: string; n: number }[];
}> {
  await requireCrmAccess();

  const { data, error } = await supabaseAdmin.rpc("marketing_customer_filter_options");
  const rows = error ? [] : (data ?? []);
  const pick = (kind: string) =>
    rows.filter((r) => r.kind === kind).map((r) => ({ value: r.value, n: Number(r.n) }));
  return {
    states: pick("state").sort((a, b) => b.n - a.n),
    // "18-24", "25-34", "55+" ... -- youngest range first.
    ages: pick("age").sort((a, b) => parseInt(a.value, 10) - parseInt(b.value, 10)),
    genders: pick("gender").sort((a, b) => b.n - a.n),
  };
}

// Which businesses each listed customer has bought from, most-used first -- the
// CRM list's Business column. A customer's orders are found the same way as in
// their purchase history (customer link, or the order's phone matching their
// phone / second phone; cancelled and voided left out), and an order that spans
// several businesses counts toward each (order_brands, migration 0058). With a
// "Bought on" range set, only orders dated in it count. Never throws: on any
// problem the column just stays empty.
async function customerBusinessNames(
  customers: Customer[],
  boughtFrom: string,
  boughtTo: string
): Promise<Record<string, string[]>> {
  if (customers.length === 0) return {};
  try {
    const quote = (s: string) => `"${s.replace(/[\\"]/g, "\\$&")}"`;
    const customersByPhone = new Map<string, string[]>();
    for (const c of customers) {
      for (const p of [c.phone, c.second_phone]) {
        const phone = p?.trim();
        if (phone) customersByPhone.set(phone, [...(customersByPhone.get(phone) ?? []), c.id]);
      }
    }
    const filters = [`customer_id.in.(${customers.map((c) => c.id).join(",")})`];
    if (customersByPhone.size > 0) {
      filters.push(`customer_phone.in.(${[...customersByPhone.keys()].map(quote).join(",")})`);
    }

    type OrderRow = {
      customer_id: string | null;
      customer_phone: string | null;
      brand_id: string;
      order_brands: { brand_id: string }[];
    };
    const orders: OrderRow[] = [];
    for (let from = 0; ; from += 1000) {
      let query = supabaseAdmin
        .from("orders")
        .select("customer_id, customer_phone, brand_id, order_brands(brand_id)")
        .neq("status", "voided")
        .neq("fulfillment_status", "cancelled")
        .or(filters.join(","))
        .order("id")
        .range(from, from + 999);
      if (boughtFrom) query = query.gte("list_at", `${boughtFrom}T00:00:00+07:00`);
      if (boughtTo) query = query.lte("list_at", `${boughtTo}T23:59:59.999+07:00`);
      const { data, error } = await query;
      if (error) return {};
      orders.push(...((data ?? []) as unknown as OrderRow[]));
      if ((data ?? []).length < 1000) break;
    }

    const brandName = new Map((await getBrands()).map((b) => [b.id, b.name]));
    const counts = new Map<string, Map<string, number>>();
    const bump = (customerId: string, brandId: string) => {
      const m = counts.get(customerId) ?? new Map<string, number>();
      m.set(brandId, (m.get(brandId) ?? 0) + 1);
      counts.set(customerId, m);
    };
    const listed = new Set(customers.map((c) => c.id));
    for (const o of orders) {
      const owners = new Set<string>();
      if (o.customer_id && listed.has(o.customer_id)) owners.add(o.customer_id);
      const phone = o.customer_phone?.trim();
      if (phone) for (const id of customersByPhone.get(phone) ?? []) owners.add(id);
      const brandIds = o.order_brands.length > 0 ? o.order_brands.map((b) => b.brand_id) : [o.brand_id];
      for (const id of owners) for (const brandId of brandIds) bump(id, brandId);
    }

    const result: Record<string, string[]> = {};
    for (const [customerId, m] of counts) {
      result[customerId] = [...m.entries()]
        .sort((a, b) => b[1] - a[1] || (brandName.get(a[0]) ?? "").localeCompare(brandName.get(b[0]) ?? ""))
        .map(([brandId]) => brandName.get(brandId) ?? "—");
    }
    return result;
  } catch {
    return {};
  }
}

export async function listCustomersAction(
  search?: string,
  page = 1,
  limit = 50,
  filters: CustomerFilters = NO_CUSTOMER_FILTERS
): Promise<{
  customers: Customer[];
  total: number;
  buying: Record<string, CustomerBuying>;
  businesses: Record<string, string[]>;
}> {
  await requireCrmAccess();

  const offset = (page - 1) * limit;

  // Filters + top-buyer ranking run in the database (migration 0064).
  const { data: ranked, error: rankedError } = await supabaseAdmin.rpc("marketing_customers", {
    p_search: search?.trim() || null,
    p_state: filters.state || null,
    p_gender: filters.gender || null,
    p_age: filters.age || null,
    p_since_from: filters.sinceFrom || null,
    p_since_to: filters.sinceTo || null,
    p_sort: filters.sort,
    p_limit: limit,
    p_offset: offset,
    p_bought_from: filters.boughtFrom || null,
    p_bought_to: filters.boughtTo || null,
  });
  if (!rankedError) {
    const buying: Record<string, CustomerBuying> = {};
    const customers = (ranked ?? []).map((r) => {
      const c = r.customer as unknown as Customer;
      buying[c.id] = { orders: Number(r.orders_count), units: Number(r.units), spent: Number(r.spent) };
      return c;
    });
    return {
      customers,
      total: Number(ranked?.[0]?.total_count ?? 0),
      buying,
      businesses: await customerBusinessNames(customers, filters.boughtFrom, filters.boughtTo),
    };
  }
  // Migration 0064 not applied yet: plain name-ordered list, no filters.
  if (rankedError.code !== "PGRST202") throw new Error(rankedError.message);

  const from = offset;
  let query = supabaseAdmin
    .from("customers")
    .select("*", { count: "exact" })
    .order("name")
    .order("id")
    .range(from, from + limit - 1);
  const term = search?.trim();
  if (term) {
    // Quoted so a comma/parenthesis typed into the search box isn't parsed as
    // part of the filter syntax.
    const pattern = `"%${term.replace(/[\\"]/g, "\\$&")}%"`;
    query = query.or(`name.ilike.${pattern},phone.ilike.${pattern}`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return {
    customers: data ?? [],
    total: count ?? 0,
    buying: {},
    businesses: await customerBusinessNames(data ?? [], "", ""),
  };
}

export async function updateCustomerAction(
  id: string,
  input: {
    name: string;
    phone?: string;
    secondPhone?: string;
    pageUid?: string;
    email?: string;
    address?: string;
    label?: string;
    source?: string;
    state?: string;
    gender?: string;
    nationality?: string;
    dob?: string;
    notes?: string;
  }
): Promise<void> {
  await requireCrmAccess();

  if (!input.name.trim()) throw new Error("Name is required");

  const { error } = await supabaseAdmin
    .from("customers")
    .update({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      second_phone: input.secondPhone?.trim() || null,
      page_uid: input.pageUid?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      label: input.label?.trim() || null,
      source: input.source?.trim() || null,
      state: input.state?.trim() || null,
      gender: input.gender?.trim() || null,
      nationality: input.nationality?.trim() || null,
      dob: input.dob || null,
      notes: input.notes?.trim() || null,
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") throw new Error("That phone number is already in use by another customer");
    throw new Error(error.message);
  }

  revalidatePath("/marketing");
}

export async function deleteCustomerAction(id: string): Promise<void> {
  await requireMarketingAccess();

  const { error } = await supabaseAdmin.from("customers").delete().eq("id", id);
  if (error) {
    // 23503 = foreign key violation -- this customer still has orders
    // pointing at it (orders.customer_id has no ON DELETE clause).
    if (error.code === "23503") {
      throw new Error("Can't delete — this customer has past orders");
    }
    throw new Error(error.message);
  }

  revalidatePath("/marketing");
}

export type CustomerPurchaseHistory = {
  orderCount: number;
  totalItems: number;
  totalSpent: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  // One entry per order (its invoice), newest first.
  orders: { id: string; invoiceNumber: string | null; createdAt: string; total: number }[];
  // One entry per item on each purchase, newest purchase first.
  items: {
    orderId: string;
    boughtAt: string;
    invoiceNumber: string | null;
    name: string;
    quantity: number;
    spent: number;
  }[];
};

// Everything a customer has bought, past to now, one row per item with the
// date it was bought. Orders are matched by customer_id, or by phone for
// orders saved before/without a link (website orders carry the phone).
// Cancelled/voided orders don't count.
export async function getCustomerPurchaseHistoryAction(
  customerId: string
): Promise<CustomerPurchaseHistory> {
  await requireCrmAccess();

  const { data: customer, error: customerErr } = await supabaseAdmin
    .from("customers")
    .select("id, phone, second_phone")
    .eq("id", customerId)
    .single();
  if (customerErr) throw new Error(customerErr.message);

  const phone = customer.phone?.trim();
  const filters = [`customer_id.eq.${customer.id}`];
  if (phone) filters.push(`customer_phone.eq."${phone.replace(/[\\"]/g, "\\$&")}"`);
  const secondPhone = customer.second_phone?.trim();
  if (secondPhone) filters.push(`customer_phone.eq."${secondPhone.replace(/[\\"]/g, "\\$&")}"`);

  const { data: orders, error: ordersErr } = await supabaseAdmin
    .from("orders")
    .select("id, created_at, paid_at, status, total")
    .or(filters.join(","))
    .neq("fulfillment_status", "cancelled")
    .neq("status", "voided")
    .order("created_at", { ascending: false });
  if (ordersErr) throw new Error(ordersErr.message);

  // Same date-based number the Orders page and the invoice show (YYYYMM-N):
  // N is the order's position among that month's paid orders.
  const invoiceNumbers = await Promise.all(
    (orders ?? []).map(async (o) => {
      if (o.status !== "paid" || !o.paid_at) return null;
      const { count } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "paid")
        .gte("paid_at", invoiceMonthStartIso(o.paid_at))
        .lt("paid_at", o.paid_at);
      return formatInvoiceNumber(o.paid_at, (count ?? 0) + 1);
    })
  );

  const history: CustomerPurchaseHistory = {
    orderCount: orders?.length ?? 0,
    totalItems: 0,
    totalSpent: 0,
    firstOrderAt: orders?.[orders.length - 1]?.created_at ?? null,
    lastOrderAt: orders?.[0]?.created_at ?? null,
    orders: (orders ?? []).map((o, idx) => ({
      id: o.id,
      invoiceNumber: invoiceNumbers[idx],
      createdAt: o.created_at,
      total: o.total,
    })),
    items: [],
  };
  if (!orders || orders.length === 0) return history;

  const { data: lines, error: linesErr } = await supabaseAdmin
    .from("order_items")
    .select("order_id, quantity, line_total, products(name)")
    .in("order_id", orders.map((o) => o.id));
  if (linesErr) throw new Error(linesErr.message);

  const linesByOrder = new Map<string, NonNullable<typeof lines>>();
  for (const l of lines ?? []) {
    linesByOrder.set(l.order_id, [...(linesByOrder.get(l.order_id) ?? []), l]);
    history.totalItems += l.quantity;
    history.totalSpent += l.line_total;
  }
  // Quantities can be fractions (a custom size), and adding those in floating
  // point leaves tails like 226.89999999999998 -- keep 2 decimals.
  history.totalItems = Math.round(history.totalItems * 100) / 100;
  history.totalSpent = Math.round(history.totalSpent * 100) / 100;
  for (const o of orders) {
    for (const l of linesByOrder.get(o.id) ?? []) {
      history.items.push({
        orderId: o.id,
        boughtAt: o.created_at,
        invoiceNumber: invoiceNumbers[orders.indexOf(o)],
        name: (l.products as { name: string } | null)?.name ?? "(deleted product)",
        quantity: l.quantity,
        spent: l.line_total,
      });
    }
  }
  return history;
}

// ---- CSV import ----------------------------------------------------------

const IMPORT_BATCH_LIMIT = 1000;

export type CustomerImportResult = {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
};

// NFC-normalized, NULs stripped (Postgres text can't hold them), and cut by
// code point so a long value never splits a surrogate pair (rare CJK, emoji).
const clean = (v: unknown, max = 500) =>
  typeof v === "string"
    ? Array.from(v.replace(/\u0000/g, "").normalize("NFC").trim()).slice(0, max).join("")
    : "";
const cleanDate = (v: unknown) => {
  const s = clean(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const cleanInt = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

// Matches customers by phone number (unique): a phone already on file has its
// EMPTY-in-the-file fields left alone and its filled ones updated; anything
// else is created. Rows with no phone can't be matched, so they always create.
// commit=false only counts, so the dialog can preview before writing.
export async function importCustomersAction(
  rows: CustomerImportRow[],
  commit: boolean
): Promise<CustomerImportResult> {
  await requireMarketingAccess();
  if (!Array.isArray(rows)) throw new Error("Invalid import data");
  if (rows.length > IMPORT_BATCH_LIMIT) throw new Error("Too many rows in one batch");

  const result: CustomerImportResult = { created: 0, updated: 0, errors: [] };

  type Clean = { row: number; phone: string; fields: Record<string, string | number | null> };
  const cleaned: Clean[] = [];
  for (const r of rows) {
    const name = clean(r.name);
    if (!name) {
      result.errors.push({ row: r.row, message: "Missing customer name" });
      continue;
    }
    // Excel's 8.55979E+11 -- the real digits are gone, never store it as a phone.
    if (/^\d(?:\.\d+)?e[+-]?\d+$/i.test(clean(r.phone, 50))) {
      result.errors.push({ row: r.row, message: "Phone number was damaged by Excel — can't import" });
      continue;
    }
    cleaned.push({
      row: r.row,
      phone: clean(r.phone, 50),
      fields: {
        name,
        second_phone: clean(r.secondPhone, 50),
        email: clean(r.email),
        photo_url: clean(r.photoUrl, 2000),
        address: clean(r.address, 1000),
        customer_since: cleanDate(r.customerSince),
        first_name: clean(r.firstName),
        last_name: clean(r.lastName),
        page_uid: clean(r.pageUid),
        source: clean(r.source),
        label: clean(r.label),
        capital: clean(r.capital),
        state: clean(r.state),
        dob: cleanDate(r.dob),
        yob: cleanInt(r.yob, 1900, 2100),
        age: clean(r.age, 20),
        gender: clean(r.gender),
        nationality: clean(r.nationality),
        follow_up: clean(r.followUp),
      },
    });
  }

  // Which phones are already customers?
  const phones = [...new Set(cleaned.map((c) => c.phone).filter(Boolean))];
  const existing = new Map<string, string>();
  for (let i = 0; i < phones.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from("customers")
      .select("id, phone")
      .in("phone", phones.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) if (c.phone) existing.set(c.phone, c.id);
  }

  // A row with no phone (damaged, or its number already belongs to another
  // customer) can't be matched by phone. If it carries a 2nd phone, match on
  // name + 2nd phone so importing the same file again doesn't add it twice.
  const secondPhones = [
    ...new Set(
      cleaned.filter((c) => !c.phone && c.fields.second_phone).map((c) => String(c.fields.second_phone))
    ),
  ];
  const existingBySecond = new Map<string, string>();
  for (let i = 0; i < secondPhones.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from("customers")
      .select("id, name, second_phone")
      .in("second_phone", secondPhones.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) {
      if (c.second_phone) existingBySecond.set(`${c.name}|${c.second_phone}`, c.id);
    }
  }

  const toInsert: Clean[] = [];
  const toUpdate: { c: Clean; id: string }[] = [];
  for (const c of cleaned) {
    const id = c.phone
      ? existing.get(c.phone)
      : existingBySecond.get(`${c.fields.name}|${c.fields.second_phone}`);
    if (id) toUpdate.push({ c, id });
    else toInsert.push(c);
  }

  if (!commit) {
    result.created = toInsert.length;
    result.updated = toUpdate.length;
    return result;
  }

  // "" means "not in the file" -> null on insert, untouched on update.
  const asNullable = (f: Clean["fields"]) =>
    Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));
  const nonEmpty = (f: Clean["fields"]) =>
    Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== null));

  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const payload = chunk.map((c) => ({
      ...asNullable(c.fields),
      name: c.fields.name as string,
      phone: c.phone || null,
    }));
    const { error } = await supabaseAdmin.from("customers").insert(payload);
    if (!error) {
      result.created += chunk.length;
      continue;
    }
    // One bad row shouldn't sink the batch -- retry row by row to find it.
    for (const c of chunk) {
      const { error: rowError } = await supabaseAdmin.from("customers").insert({
        ...asNullable(c.fields),
        name: c.fields.name as string,
        phone: c.phone || null,
      });
      if (rowError) {
        result.errors.push({
          row: c.row,
          message: rowError.code === "23505" ? "Phone number already in use" : rowError.message,
        });
      } else {
        result.created++;
      }
    }
  }

  for (let i = 0; i < toUpdate.length; i += 20) {
    await Promise.all(
      toUpdate.slice(i, i + 20).map(async ({ c, id }) => {
        const { error } = await supabaseAdmin.from("customers").update(nonEmpty(c.fields) as Partial<Omit<Customer, "id" | "created_at">>).eq("id", id);
        if (error) result.errors.push({ row: c.row, message: error.message });
        else result.updated++;
      })
    );
  }

  revalidatePath("/marketing");
  return result;
}
