"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import ThemeToggle from "@/components/ThemeToggle";
import DeliveryAlertBell from "@/components/DeliveryAlertBell";
import LiveOrdersWatcher from "@/components/LiveOrdersWatcher";
import { staffRoleLabel } from "@/types/database";
import { toggleMobileNav } from "@/lib/mobileNav";

export default function TopBar({
  fullName,
  role,
  avatarUrl,
}: {
  fullName: string;
  role: string;
  avatarUrl?: string | null;
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    function onDoc(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [profileOpen]);

  // Hide on scroll down, show on scroll up. The bar is in normal flow above
  // #app-scroll-area, so hiding pulls it up by its own height (negative margin)
  // and the content slides up to fill the space.
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const header = headerRef.current;
    const area = document.getElementById("app-scroll-area");
    if (!header || !area) return;
    const setHidden = (hidden: boolean) => {
      header.style.marginTop = hidden ? `-${header.offsetHeight}px` : "0px";
    };
    setHidden(false);
    let lastTop = area.scrollTop;
    function onScroll() {
      const top = area!.scrollTop;
      const delta = top - lastTop;
      if (top < 60) setHidden(false);
      else if (delta > 6) setHidden(true);
      else if (delta < -6) setHidden(false);
      if (Math.abs(delta) > 6) lastTop = top;
    }
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => area.removeEventListener("scroll", onScroll);
  }, [pathname]);

  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  return (
    <header
      ref={headerRef}
      className="print:hidden relative z-30 flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-3 transition-[margin] duration-300 sm:gap-3 sm:px-6"
    >
      <LiveOrdersWatcher />
      {/* Phones/tablets: the sidebar is a slide-out menu opened from here. */}
      <button
        type="button"
        onClick={toggleMobileNav}
        aria-label="Open menu"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      {/* A page can portal its own title/filters in here (see TopBarSlot)
          instead of rendering a separate row below this bar. */}
      <div id="topbar-left-slot" className="flex min-w-0 flex-1 items-center gap-3" />
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <DeliveryAlertBell />
        <ThemeToggle />
        <div ref={profileRef} className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            aria-label="Profile"
            aria-expanded={profileOpen}
            className="flex items-center gap-2.5 rounded-full border border-border bg-muted/60 py-1 pl-1 transition-colors hover:bg-muted sm:pr-3"
          >
            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-brand/20 text-xs font-bold text-brand">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                initials
              )}
            </span>
            <div className="hidden text-left leading-tight sm:block">
              <div className="text-sm font-medium">{fullName}</div>
              <div className="text-xs text-muted-foreground">{staffRoleLabel(role)}</div>
            </div>
          </button>

          {profileOpen && (
            <div className="absolute top-full right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              <div className="h-16 bg-gradient-to-r from-brand/40 to-brand/10" />
              <div className="-mt-12 flex flex-col items-center px-5 pb-5 text-center">
                <span className="grid size-24 place-items-center overflow-hidden rounded-full border-4 border-card bg-brand/20 text-3xl font-bold text-brand shadow-md">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt={fullName} className="size-full object-cover" />
                  ) : (
                    initials
                  )}
                </span>
                <div className="mt-3 text-lg font-semibold">{fullName}</div>
                <span className="mt-1 rounded-full bg-brand/15 px-3 py-0.5 text-xs font-medium text-brand">
                  {staffRoleLabel(role)}
                </span>
              </div>
            </div>
          )}
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            title="Log out"
            className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground hover:text-red-500"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
