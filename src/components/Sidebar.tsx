"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Calculator,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Package,
  ShoppingCart,
  Users,
} from "lucide-react";

const topItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "sales", "stock", "accountance", "marketing"],
  },
  { href: "/sales", label: "Sales", icon: ShoppingCart, roles: ["admin", "sales"] },
  { href: "/stock", label: "Stock", icon: Package, roles: ["admin", "stock"] },
  {
    href: "/orders",
    label: "Orders",
    icon: ClipboardList,
    roles: ["admin", "sales", "stock", "accountance", "marketing"],
  },
];

const bottomItems = [
  { href: "/marketing", label: "Marketing", icon: Megaphone, roles: ["admin", "marketing"] },
  { href: "/users", label: "Staff Accounts", icon: Users, roles: ["admin"] },
];

// Mirrors AccountanceTab from src/app/(app)/accountance/page.tsx -- kept as
// a literal list here (rather than imported) since that file is a server
// component and this needs to stay a plain client-safe array.
const ACCOUNTANCE_LINKS = [
  { tab: "reconciliation", label: "Cash Reconciliation" },
  { tab: "reports", label: "Financial Reporting & P&L" },
  { tab: "expenses", label: "Expense & Accounts Payable" },
  { tab: "cogs", label: "COGS & Margin Tracking" },
];
const ACCOUNTANCE_ROLES = ["admin", "accountance"];

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isOnAccountance = pathname.startsWith("/accountance");
  const currentTab = searchParams.get("tab") ?? "reconciliation";

  // Starts open when landing on a route it contains, and re-opens if
  // navigated there later -- but once open, toggling it closed sticks until
  // the route changes again, rather than snapping back open on every
  // in-page change (switching business/tab). Adjusted during render
  // (React's documented pattern for state that depends on a changed prop)
  // rather than in an effect, so it takes effect in the same commit.
  const [accountanceOpen, setAccountanceOpen] = useState(isOnAccountance);
  const [wasOnAccountance, setWasOnAccountance] = useState(isOnAccountance);
  if (isOnAccountance !== wasOnAccountance) {
    setWasOnAccountance(isOnAccountance);
    if (isOnAccountance) setAccountanceOpen(true);
  }

  const showAccountance = ACCOUNTANCE_ROLES.includes(role);

  function topLinkClass(active: boolean) {
    return `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      active ? "bg-brand text-black" : "text-muted-foreground hover:bg-muted"
    }`;
  }

  function subLinkClass(active: boolean) {
    return `rounded-lg px-3 py-1.5 text-sm transition-colors ${
      active ? "font-medium text-brand" : "text-muted-foreground hover:bg-muted"
    }`;
  }

  return (
    <aside className="print:hidden flex min-h-screen w-64 shrink-0 flex-col gap-8 border-r border-border bg-card p-6">
      <Link href="/" className="font-display text-lg font-bold">
        NOVA POS
      </Link>
      <nav className="flex flex-col gap-1">
        {topItems
          .filter((item) => item.roles.includes(role))
          .map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={topLinkClass(isActive)}>
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}

        {/* Accountance -- header itself still links to the page (default
            tab), same as before this session's edits; the chevron only
            toggles the sub-list. */}
        {showAccountance && (
          <div>
            <div
              className={`flex items-center gap-3 rounded-lg pr-2 pl-3 text-sm font-medium transition-colors ${
                isOnAccountance ? "bg-brand text-black" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Link href="/accountance" className="flex flex-1 items-center gap-3 py-2.5">
                <Calculator className="size-4" />
                Accountance
              </Link>
              <button
                type="button"
                onClick={() => setAccountanceOpen((open) => !open)}
                aria-expanded={accountanceOpen}
                aria-label={accountanceOpen ? "Collapse Accountance" : "Expand Accountance"}
                className={`rounded p-1 ${isOnAccountance ? "hover:bg-black/10" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${accountanceOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>
            {accountanceOpen && (
              <div className="mt-1 flex flex-col gap-0.5 border-l border-border pl-4">
                {ACCOUNTANCE_LINKS.map((l) => (
                  <Link
                    key={l.tab}
                    href={`/accountance?tab=${l.tab}`}
                    className={subLinkClass(isOnAccountance && currentTab === l.tab)}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {bottomItems
          .filter((item) => item.roles.includes(role))
          .map((item) => (
            <Link key={item.href} href={item.href} className={topLinkClass(pathname.startsWith(item.href))}>
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
      </nav>
    </aside>
  );
}
