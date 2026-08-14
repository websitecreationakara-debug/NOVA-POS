"use server";

import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/auth-server";
import type { StaffRole } from "@/types/database";

const ROLE_HOME: Record<StaffRole, string> = {
  admin: "/",
  sales: "/sales",
  stock: "/stock",
  accountance: "/accountance",
  marketing: "/marketing",
};

export async function setPasswordAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match" };
  }

  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.updateUser({ password });

  if (error || !data.user) {
    return { error: "Couldn't set your password. Your setup link may have expired -- ask an admin to send a new one." };
  }

  const role = data.user.user_metadata?.role as StaffRole | undefined;
  redirect(role && role in ROLE_HOME ? ROLE_HOME[role] : "/login");
}
