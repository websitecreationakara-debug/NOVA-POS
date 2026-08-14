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

export async function loginAction(
  _prevState: { error: string | null },
  formData: FormData
): Promise<{ error: string | null }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password" };
  }

  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Incorrect email or password" };
  }

  const role = data.user.user_metadata?.role as StaffRole | undefined;
  if (!role || !(role in ROLE_HOME)) {
    await supabase.auth.signOut();
    return { error: "This account has no role assigned. Ask an admin to set one." };
  }

  redirect(ROLE_HOME[role]);
}

export async function logoutAction() {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
  redirect("/login");
}
