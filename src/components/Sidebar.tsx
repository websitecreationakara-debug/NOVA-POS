"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Calculator,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import { getNewOnlineOrdersCountAction } from "@/app/(app)/orders/actions";
import { ORDERS_CHANGED } from "@/lib/ordersChanged";
import { TOGGLE_MOBILE_NAV } from "@/lib/mobileNav";

// Active nav item: the logo's blue-to-cyan gradient.
const NAV_ACTIVE = "bg-gradient-to-r from-[#2879bd] to-[#3f9fd0] text-white shadow-sm";
const NAV_ACTIVE_TEXT = "font-medium text-[#2b7fc4] dark:text-[#4ab3d3]";

const topItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "sales", "stock", "accountance", "marketing"],
  },
  { href: "/sales", label: "Sales", icon: ShoppingCart, roles: ["admin", "sales", "accountance"] },
  { href: "/stock", label: "Stock", icon: Package, roles: ["admin", "stock", "accountance"] },
  {
    href: "/orders",
    label: "Orders",
    icon: ClipboardList,
    roles: ["admin", "sales", "stock", "accountance", "marketing"],
  },
];

const bottomItems = [
  { href: "/users", label: "Staff Accounts", icon: Users, roles: ["admin"] },
];

// Mirrors the `tab` query param the Marketing page itself reads -- kept as a
// literal list here for the same reason ACCOUNTANCE_LINKS is (this file
// needs to stay a plain client-safe array).
const MARKETING_LINKS = [
  { tab: "promotions", label: "CRM" },
  { tab: "cost-control", label: "Cost Control" },
];
const MARKETING_ROLES = ["admin", "marketing", "accountance"];

// Mirrors AccountanceTab from src/app/(app)/accountance/page.tsx -- kept as
// a literal list here (rather than imported) since that file is a server
// component and this needs to stay a plain client-safe array.
const ACCOUNTANCE_LINKS = [
  { tab: "reconciliation", label: "Cash Reconciliation" },
  { tab: "expenses", label: "Expense & Accounts Payable" },
  { tab: "reports", label: "Financial Reporting & P&L" },
  { tab: "cogs", label: "COGS & Margin Tracking" },
];
const ACCOUNTANCE_ROLES = ["admin", "accountance"];

// Remembered per browser so the sidebar stays how the staff member left it.
const COLLAPSED_KEY = "nova:sidebar-collapsed";

// Below Tailwind's `lg` (1024px) the sidebar is a slide-out menu instead of a
// fixed column; collapsing to icons only makes sense for the column.
const DESKTOP_QUERY = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

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

  // Collapsed = icons only. Read from storage after mount (the server can't
  // know it), so a collapsed sidebar briefly renders open on a fresh load.
  const [collapsedPref, setCollapsed] = useState(false);
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  );
  const collapsed = collapsedPref && isDesktop;

  // The slide-out menu (phones/tablets), opened by the TopBar's hamburger.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setMobileOpen((o) => !o);
    window.addEventListener(TOGGLE_MOBILE_NAV, toggle);
    return () => window.removeEventListener(TOGGLE_MOBILE_NAV, toggle);
  }, []);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the saved choice after mount; reading storage during render would differ from the server HTML
      if (localStorage.getItem(COLLAPSED_KEY) === "1") setCollapsed(true);
    } catch {
      // storage blocked -- stays expanded
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // storage blocked -- the choice just won't be remembered
      }
      return next;
    });
  }

  const isOnMarketing = pathname.startsWith("/marketing");
  const currentMarketingTab = searchParams.get("tab") ?? "promotions";

  // Same open/close behavior as Accountance's dropdown above.
  const [marketingOpen, setMarketingOpen] = useState(isOnMarketing);
  const [wasOnMarketing, setWasOnMarketing] = useState(isOnMarketing);
  if (isOnMarketing !== wasOnMarketing) {
    setWasOnMarketing(isOnMarketing);
    if (isOnMarketing) setMarketingOpen(true);
  }

  const showMarketing = MARKETING_ROLES.includes(role);

  // Badge on "Orders" -- how many storefront orders are sitting unhandled,
  // so staff notice a customer bought from the website without needing the
  // (removed) voice announcement. No timer of its own: this count only ever
  // changes when an order is created or its status changes, both of which
  // LiveOrdersWatcher (mounted in TopBar) already detects and announces via
  // ORDERS_CHANGED -- reacting to that (plus mount and window focus) keeps
  // this accurate without adding a 4th independent poll loop running on
  // every open tab all day.
  const [newOnlineOrdersCount, setNewOnlineOrdersCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const count = await getNewOnlineOrdersCountAction();
        if (!cancelled) setNewOnlineOrdersCount(count);
      } catch {
        // transient network hiccup -- next event tries again
      }
    }
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(ORDERS_CHANGED, onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ORDERS_CHANGED, onFocus);
    };
  }, []);

  function topLinkClass(active: boolean) {
    return `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      collapsed ? "justify-center" : ""
    } ${active ? NAV_ACTIVE : "text-muted-foreground hover:bg-muted"}`;
  }

  function subLinkClass(active: boolean) {
    return `rounded-lg px-3 py-1.5 text-sm transition-colors ${
      active ? NAV_ACTIVE_TEXT : "text-muted-foreground hover:bg-muted"
    }`;
  }

  return (
    <>
    {mobileOpen && (
      <div
        className="fixed inset-0 z-30 bg-black/40 lg:hidden print:hidden"
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />
    )}
    <aside
      className={`print:hidden fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col gap-8 overflow-y-auto border-r border-border bg-card transition-[width,transform] duration-200 lg:static lg:z-auto lg:min-h-screen lg:translate-x-0 lg:overflow-visible ${
        mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      } ${collapsed ? "w-[4.75rem] px-3 py-6" : "w-64 p-6"}`}
    >
      {!collapsed && (
        <div className="flex items-start justify-between">
          <Link href="/" aria-label="NOVA POS" onClick={() => setMobileOpen(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/nova-pos.png" alt="NOVA POS" className="h-20 w-auto" />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
      <nav
        className="flex flex-col gap-1"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
        }}
      >
        {topItems
          .filter((item) => item.roles.includes(role))
          .map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={topLinkClass(isActive)}
              >
                <item.icon className="size-4" />
                {!collapsed && item.label}
                {item.href === "/orders" && newOnlineOrdersCount > 0 && (
                  <span
                    className={`grid min-w-[1.375rem] place-items-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm ${
                      collapsed ? "absolute top-0.5 right-0.5 min-w-4 px-1 py-0 text-[10px]" : "ml-auto"
                    } ${isActive ? "ring-2 ring-black/15" : ""}`}
                  >
                    {newOnlineOrdersCount}
                  </span>
                )}
              </Link>
            );
          })}

        {/* Accountance -- header itself still links to the page (default
            tab); the chevron only toggles the sub-list. */}
        {showAccountance && (
          <div>
            <div
              className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-3" : "pr-2 pl-3"
              } ${isOnAccountance ? NAV_ACTIVE : "text-muted-foreground hover:bg-muted"}`}
            >
              <Link
                href="/accountance"
                title={collapsed ? "Accounting" : undefined}
                className={`flex items-center gap-3 py-2.5 ${collapsed ? "" : "flex-1"}`}
              >
                <Calculator className="size-4" />
                {!collapsed && "Accounting"}
              </Link>
              {!collapsed && (
              <button
                type="button"
                onClick={() => setAccountanceOpen((open) => !open)}
                aria-expanded={accountanceOpen}
                aria-label={accountanceOpen ? "Collapse Accounting" : "Expand Accounting"}
                className={`rounded p-1 ${isOnAccountance ? "hover:bg-white/20" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${accountanceOpen ? "rotate-180" : ""}`}
                />
              </button>
              )}
            </div>
            {accountanceOpen && !collapsed && (
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

        {showMarketing && (
          <div>
            <div
              className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-3" : "pr-2 pl-3"
              } ${isOnMarketing ? NAV_ACTIVE : "text-muted-foreground hover:bg-muted"}`}
            >
              <Link
                href="/marketing"
                title={collapsed ? "Marketing" : undefined}
                className={`flex items-center gap-3 py-2.5 ${collapsed ? "" : "flex-1"}`}
              >
                <Megaphone className="size-4" />
                {!collapsed && "Marketing"}
              </Link>
              {!collapsed && (
              <button
                type="button"
                onClick={() => setMarketingOpen((open) => !open)}
                aria-expanded={marketingOpen}
                aria-label={marketingOpen ? "Collapse Marketing" : "Expand Marketing"}
                className={`rounded p-1 ${isOnMarketing ? "hover:bg-white/20" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${marketingOpen ? "rotate-180" : ""}`}
                />
              </button>
              )}
            </div>
            {marketingOpen && !collapsed && (
              <div className="mt-1 flex flex-col gap-0.5 border-l border-border pl-4">
                {MARKETING_LINKS.map((l) => (
                  <Link
                    key={l.tab}
                    href={`/marketing?tab=${l.tab}`}
                    className={subLinkClass(isOnMarketing && currentMarketingTab === l.tab)}
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
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={topLinkClass(pathname.startsWith(item.href))}
            >
              <item.icon className="size-4" />
              {!collapsed && item.label}
            </Link>
          ))}
      </nav>

      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : undefined}
        className={`mt-auto hidden items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted lg:flex ${
          collapsed ? "justify-center border border-border" : ""
        }`}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed && "Collapse"}
      </button>
    </aside>
    </>
  );
}
