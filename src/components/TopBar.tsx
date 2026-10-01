"use client";

import { LogOut, Menu } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import ThemeToggle from "@/components/ThemeToggle";
import DeliveryAlertBell from "@/components/DeliveryAlertBell";
import LiveOrdersWatcher from "@/components/LiveOrdersWatcher";
import { staffRoleLabel } from "@/types/database";
import { toggleMobileNav } from "@/lib/mobileNav";

export default function TopBar({ fullName, role }: { fullName: string; role: string }) {
  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  return (
    <header className="print:hidden flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-3 sm:gap-3 sm:px-6">
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
        <div className="flex items-center gap-2.5 rounded-full border border-border bg-muted/60 py-1 pl-1 sm:pr-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/20 text-xs font-bold text-brand">
            {initials}
          </span>
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-medium">{fullName}</div>
            <div className="text-xs text-muted-foreground">{staffRoleLabel(role)}</div>
          </div>
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
