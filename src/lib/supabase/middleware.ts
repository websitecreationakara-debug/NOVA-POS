import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { StaffRole } from "@/types/database";

const ROLE_HOME: Record<StaffRole, string> = {
  admin: "/",
  sales: "/sales",
  stock: "/stock",
  accountance: "/accountance",
  marketing: "/marketing",
};

const ROLE_ALLOWED_PREFIXES: Record<StaffRole, string[]> = {
  admin: ["/", "/sales", "/stock", "/accountance", "/marketing", "/invoice", "/users", "/orders"],
  // TEMPORARY: sales also has Stock access until Demo asks to close it again.
  sales: ["/", "/sales", "/invoice", "/stock", "/orders"],
  stock: ["/", "/stock", "/orders"],
  accountance: ["/", "/accountance", "/invoice", "/orders"],
  marketing: ["/", "/marketing", "/orders"],
};

function isAllowed(role: StaffRole, pathname: string) {
  return ROLE_ALLOWED_PREFIXES[role].some((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p)));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { pathname } = request.nextUrl;

  // This client-side page reads the recovery tokens out of the URL hash
  // fragment (never sent to the server) and calls setSession() itself --
  // there's no cookie session yet when it first loads, so let it through
  // unconditionally; it redirects to /reset-password once setSession() succeeds.
  if (pathname.startsWith("/auth/callback")) {
    return response;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = pathname === "/login";
  const isResetPasswordPage = pathname === "/reset-password";

  if (!user) {
    if (isLoginPage) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Reachable by any authenticated user regardless of role, since a
  // just-created account may not have finished setting its password yet.
  if (isResetPasswordPage) return response;

  const role = user.user_metadata?.role as StaffRole | undefined;

  if (!role || !(role in ROLE_HOME)) {
    if (isLoginPage) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no-role");
    return NextResponse.redirect(url);
  }

  if (isLoginPage || !isAllowed(role, pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = ROLE_HOME[role];
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
