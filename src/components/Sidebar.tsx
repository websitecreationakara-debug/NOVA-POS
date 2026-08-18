"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calculator,
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Package,
  ShoppingCart,
  Users,
} from "lucide-react";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "sales", "stock", "accountance", "marketing"],
  },
  { href: "/sales", label: "Sales", icon: ShoppingCart, roles: ["admin", "sales"] },
  // TEMPORARY: sales also has Stock access until Demo asks to close it again.
  { href: "/stock", label: "Stock", icon: Package, roles: ["admin", "stock", "sales"] },
  {
    href: "/orders",
    label: "Orders",
    icon: ClipboardList,
    roles: ["admin", "sales", "stock", "accountance", "marketing"],
  },
  { href: "/accountance", label: "Accountance", icon: Calculator, roles: ["admin", "accountance"] },
  { href: "/marketing", label: "Marketing", icon: Megaphone, roles: ["admin", "marketing"] },
  { href: "/users", label: "Staff Accounts", icon: Users, roles: ["admin"] },
];

export default function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const items = navItems.filter((item) => item.roles.includes(role));

  return (
    <aside className="print:hidden flex min-h-screen w-64 shrink-0 flex-col gap-8 border-r border-border bg-card p-6">
      <Link href="/" className="font-display text-lg font-bold">
        NOVA POS
      </Link>
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "bg-brand text-black" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
