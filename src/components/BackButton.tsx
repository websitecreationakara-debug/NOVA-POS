"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// "Back" to wherever the user came from (the Orders list, a customer's purchase
// history, an order's detail page ...). If the page was opened directly -- a
// pasted link or a new tab, so there's nothing to go back to -- it goes to
// `fallbackHref` instead.
export default function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium whitespace-nowrap hover:bg-black/[.04] dark:hover:bg-white/[.06] print:hidden"
    >
      <ArrowLeft className="size-4" />
      Back
    </button>
  );
}
