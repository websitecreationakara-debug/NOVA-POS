"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, LayoutDashboard, Megaphone, Package, ShoppingCart } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sales", label: "Sales", icon: ShoppingCart },
  { href: "/stock", label: "Stock", icon: Package },
  { href: "/accountance", label: "Accountance", icon: Calculator },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex min-h-screen w-64 shrink-0 flex-col gap-8 border-r border-border bg-card p-6">
      <Link href="/" className="font-display text-lg font-bold">
        NOVA POS
      </Link>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
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
