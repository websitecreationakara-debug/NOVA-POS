"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth-server";
import type { StaffRole } from "@/types/database";

const VALID_ROLES: StaffRole[] = ["admin", "sales", "stock", "accountance", "marketing"];

export async function createStaffAccountAction(input: {
  fullName: string;
  email: string;
  role: StaffRole;
  password: string;
}): Promise<void> {
  // Defense in depth: the /users route is already role-gated in proxy.ts,
  // but Server Actions are their own endpoint and reachable independent of
  // which page rendered them, so re-check here rather than trust the route.
  const caller = await getSessionUser();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can create staff accounts");
  }

  const { fullName, email, role, password } = input;
  if (!fullName.trim()) throw new Error("Name is required");
  if (!email.trim()) throw new Error("Email is required");
  if (!VALID_ROLES.includes(role)) throw new Error("Invalid role");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { role, full_name: fullName.trim() },
  });

  if (createError || !created.user) {
    throw new Error(createError?.message ?? "Failed to create account");
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert({ id: created.user.id, full_name: fullName.trim(), role }, { onConflict: "id" });

  if (profileError) {
    throw new Error(profileError.message);
  }

  revalidatePath("/users");
}

export async function deleteStaffAccountAction(userId: string): Promise<void> {
  const caller = await getSessionUser();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can delete staff accounts");
  }
  if (caller.id === userId) {
    throw new Error("You can't delete your own account while logged in as it");
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (error) {
    // profiles.id cascades from auth.users, but orders/expenses/stock_adjustments
    // reference profiles(id) without ON DELETE CASCADE -- once this account has
    // created real records, Postgres blocks the delete. Supabase masks the actual
    // Postgres error behind a generic "Database error deleting user" message
    // (confirmed via a live test), so there's no reliable text to pattern-match --
    // any failure here on a valid, existing user id is realistically this case.
    console.error("deleteStaffAccountAction: deleteUser failed", error);
    throw new Error(
      "Can't delete — this account has created orders, stock adjustments, or expenses, and deleting it would break that history."
    );
  }

  revalidatePath("/users");
}

export async function listStaffAction(): Promise<
  { id: string; fullName: string; role: string; email: string | null; createdAt: string }[]
> {
  const caller = await getSessionUser();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can view staff accounts");
  }

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, role, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
  const emailById = new Map((usersData?.users ?? []).map((u) => [u.id, u.email ?? null]));

  return (profiles ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    role: p.role,
    email: emailById.get(p.id) ?? null,
    createdAt: p.created_at,
  }));
}
