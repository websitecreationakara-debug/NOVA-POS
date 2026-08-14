"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handle() {
      const supabase = createBrowserSupabaseClient();

      // Supabase's admin-generated recovery links come back as implicit-flow
      // tokens in the URL hash (#access_token=...), not a ?code= query param --
      // hash fragments never reach the server, so this has to run client-side.
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashError = hashParams.get("error_description");

      if (hashError) {
        setError(hashError);
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setError(error.message);
          return;
        }
        router.replace("/reset-password");
        return;
      }

      // Fallback in case a future/different link uses the PKCE ?code= flow instead.
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setError(error.message);
          return;
        }
        router.replace("/reset-password");
        return;
      }

      setError("This link is missing its login token. Ask an admin to send a new one.");
    }

    handle();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        {error ? (
          <>
            <h1 className="font-display text-xl font-bold text-red-500">Link problem</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
