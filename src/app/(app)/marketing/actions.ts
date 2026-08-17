"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import type { Customer, DiscountType, Promotion } from "@/types/database";

async function requireMarketingAccess() {
  // Defense in depth: /marketing is already role-gated in proxy.ts, but
  // Server Actions are their own endpoint and reachable independent of
  // which page rendered them, so re-check here rather than trust the route.
  const caller = await getSessionUser();
  if (caller?.role !== "admin" && caller?.role !== "marketing") {
    throw new Error("Only admin or marketing staff can manage promotions and customers");
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
