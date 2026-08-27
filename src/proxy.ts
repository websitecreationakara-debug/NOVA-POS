import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Excludes Next internals, any public/ static asset (images, icons, etc.) by
  // extension, and the site-sync endpoints -- without the asset exclusion,
  // e.g. /logos/*.png gets caught by the auth check and redirected to "/"
  // instead of serving the file. /api/stock-sync and /api/product-sync
  // authenticate themselves via a bearer secret (see each route.ts) since
  // their caller is another server, not a logged-in user, so the
  // session-cookie check here would always incorrectly 307 them.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/stock-sync|api/product-sync|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
