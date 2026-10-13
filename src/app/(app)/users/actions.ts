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

export async function updateStaffRoleAction(userId: string, role: StaffRole): Promise<void> {
  const caller = await getSessionUser();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can change staff roles");
  }
  if (!VALID_ROLES.includes(role)) throw new Error("Invalid role");
  if (caller.id === userId) {
    throw new Error("You can't change your own role while logged in as it");
  }

  // The route guard (middleware) and getSessionUser both read the role off the
  // auth user's metadata, so that has to be updated for the change to take
  // effect; profiles.role is kept in sync for the staff list / any RLS that
  // keys off it. user_metadata is merged top-level, so full_name is preserved.
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { role },
  });
  if (authError) throw new Error(authError.message);

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (profileError) throw new Error(profileError.message);

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
  {
    id: string;
    fullName: string;
    role: string;
    email: string | null;
    avatarUrl: string | null;
    createdAt: string;
  }[]
> {
  const caller = await getSessionUser();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can view staff accounts");
  }

  // `*` rather than an explicit column list so the page still loads if the
  // 0077 avatar_url migration hasn't been applied yet (p.avatar_url is just
  // undefined until then).
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
  const emailById = new Map((usersData?.users ?? []).map((u) => [u.id, u.email ?? null]));

  return (profiles ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    role: p.role,
    email: emailById.get(p.id) ?? null,
    avatarUrl: p.avatar_url ?? null,
    createdAt: p.created_at,
  }));
}

const AVATAR_BUCKET = "staff-avatars";
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

// The storage path of an avatar from its public URL, so an old photo can be removed.
function avatarPath(url: string | null | undefined): string | null {
  return url?.split(`/${AVATAR_BUCKET}/`)[1] ?? null;
}

export async function uploadStaffAvatarAction(formData: FormData): Promise<void> {
  const caller = await getSessionUser();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can change staff photos");
  }

  const userId = formData.get("userId");
  const file = formData.get("file");
  if (typeof userId !== "string" || !userId) throw new Error("Missing staff member");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file");
  if (!AVATAR_TYPES.includes(file.type)) throw new Error("Photo must be a PNG, JPG, WEBP or GIF");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Photo must be under 2MB");

  const { data: before, error: fetchError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!before) throw new Error("Staff member not found");

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) throw new Error(uploadError.message);

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path);

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", userId);
  if (updateError) {
    await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([path]);
    // 42703 = undefined column, PGRST204 = column missing from PostgREST's schema cache.
    if (updateError.code === "42703" || updateError.code === "PGRST204") {
      throw new Error("Staff photos need migration 0077 to be applied first");
    }
    throw new Error(updateError.message);
  }

  // Best-effort: don't fail the upload if the old photo is already gone.
  const oldPath = avatarPath(before.avatar_url);
  if (oldPath) await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([oldPath]);

  revalidatePath("/users");
}

export async function removeStaffAvatarAction(userId: string): Promise<void> {
  const caller = await getSessionUser();
  if (caller?.role !== "admin") {
    throw new Error("Only admins can change staff photos");
  }

  const { data: before, error: fetchError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", userId);
  if (updateError) throw new Error(updateError.message);

  const oldPath = avatarPath(before?.avatar_url);
  if (oldPath) await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([oldPath]);

  revalidatePath("/users");
}
