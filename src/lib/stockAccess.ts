import { getSessionUser } from "@/lib/supabase/auth-server";

// Server Actions are their own endpoint, reachable regardless of which page
// rendered them, so the /stock route guard in middleware isn't enough -- every
// Stock action re-checks the role. Only the admin and stock roles get in.
const STOCK_ACCESS_ROLES = new Set(["admin", "stock"]);

export async function requireStockAccess() {
  const user = await getSessionUser();
  if (!user || !STOCK_ACCESS_ROLES.has(user.role)) {
    throw new Error("You don't have access to Stock");
  }
  return user;
}
