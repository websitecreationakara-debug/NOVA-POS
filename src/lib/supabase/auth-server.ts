import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createAuthClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render, not an action/route --
            // middleware already refreshes the session cookie, so this is safe to ignore.
          }
        },
      },
    }
  );
}

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: string;
};

// `supabase.auth.getUser()` makes a network call to the Supabase Auth server to
// validate the token. A single page render can call this several times (the app
// layout, plus every Server Action it invokes re-checks the role) -- `cache()`
// dedupes them to one round-trip per request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Staff",
    role: (user.user_metadata?.role as string | undefined) ?? "",
  };
});
