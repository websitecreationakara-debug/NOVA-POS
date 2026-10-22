"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PREV_URL_KEY } from "@/components/ScrollRestorer";

// A "← Back to …" link. When the user just came from that page it goes back in
// the browser history instead of opening it fresh, so the list comes back with the
// same filters, page and scroll position (see ScrollRestorer). Opened directly (a
// pasted link, a new tab) it is an ordinary link to `href`.
export default function BackLink({
  href,
  className,
  skipIfPrevIncludes,
  children,
}: {
  href: string;
  className?: string;
  // Don't go "back" when the previous address contains this (e.g. a page that
  // isn't the list the link points at, like a set that was just created).
  skipIfPrevIncludes?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Link
      href={href}
      data-restore-scroll
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        let prev: string | null = null;
        try {
          prev = sessionStorage.getItem(PREV_URL_KEY);
        } catch {
          return;
        }
        if (!prev) return;
        const path = (url: string) => url.split(/[?#]/)[0];
        if (path(prev) !== path(href)) return;
        if (skipIfPrevIncludes && prev.includes(skipIfPrevIncludes)) return;
        e.preventDefault();
        router.back();
      }}
    >
      {children}
    </Link>
  );
}
