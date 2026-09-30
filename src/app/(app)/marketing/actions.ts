"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import type { Customer, DiscountType, Promotion } from "@/types/database";
import type { CustomerImportRow } from "@/lib/customerCsv";

export async function requireMarketingAccess() {
  // Defense in depth: /marketing is already role-gated in proxy.ts, but
  // Server Actions are their own endpoint and reachable independent of
  // which page rendered them, so re-check here rather than trust the route.
  const caller = await getSessionUser();
  if (caller?.role !== "admin" && caller?.role !== "marketing" && caller?.role !== "accountance") {
    throw new Error("Only admin, marketing or Cooperate Admin staff can manage promotions and customers");
  }
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

export async function listCustomersAction(search?: string): Promise<Customer[]> {
  await requireMarketingAccess();

  let query = supabaseAdmin.from("customers").select("*").order("name").limit(200);
  const term = search?.trim();
  if (term) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updateCustomerAction(
  id: string,
  input: {
    name: string;
    phone?: string;
    secondPhone?: string;
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
  await requireMarketingAccess();

  if (!input.name.trim()) throw new Error("Name is required");

  const { error } = await supabaseAdmin
    .from("customers")
    .update({
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      second_phone: input.secondPhone?.trim() || null,
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

// ---- CSV import ----------------------------------------------------------

const IMPORT_BATCH_LIMIT = 1000;

export type CustomerImportResult = {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
};

const clean = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
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

  const toInsert: Clean[] = [];
  const toUpdate: { c: Clean; id: string }[] = [];
  for (const c of cleaned) {
    const id = c.phone ? existing.get(c.phone) : undefined;
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
