import { getSessionUser } from "@/lib/supabase/auth-server";

// Server Actions are their own endpoint, reachable regardless of which page
// rendered them, so the /stock route guard in middleware isn't enough -- every
// Stock action re-checks the role. The admin, stock and accountance
// ("Cooperate Admin") roles get in, plus sales ("Sale Customer Support") and
// marketing ("Marketing Promotion"), who can open the Stock page too.
const STOCK_ACCESS_ROLES = new Set(["admin", "stock", "accountance", "sales", "marketing"]);
// What the Stock page's own roles had before sales/marketing were let in -- for
// actions that belong to the Accounting page (editing/deleting waste entries),
// which those two roles can't open.
const FULL_STOCK_ACCESS_ROLES = new Set(["admin", "stock", "accountance"]);

export async function requireStockAccess() {
  const user = await getSessionUser();
  if (!user || !STOCK_ACCESS_ROLES.has(user.role)) {
    throw new Error("You don't have access to Stock");
  }
  return user;
}

export async function requireFullStockAccess() {
  const user = await getSessionUser();
  if (!user || !FULL_STOCK_ACCESS_ROLES.has(user.role)) {
    throw new Error("You don't have access to Stock");
  }
  return user;
}
