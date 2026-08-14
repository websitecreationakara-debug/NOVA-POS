import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Excludes Next internals and any public/ static asset (images, icons,
  // etc.) by extension -- without this, e.g. /logos/*.png gets caught by
  // the auth check and redirected to "/" instead of serving the file.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
