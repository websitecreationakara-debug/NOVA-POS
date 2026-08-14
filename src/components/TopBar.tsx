"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Search } from "lucide-react";
import { logoutAction } from "@/app/login/actions";

export default function TopBar({ fullName, role }: { fullName: string; role: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/sales?q=${encodeURIComponent(q)}` : "/sales");
  }

  return (
    <header className="print:hidden flex shrink-0 items-center gap-4 border-b border-border bg-card px-6 py-3">
      <form onSubmit={handleSubmit} className="max-w-md flex-1">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search product name or SKU…"
            className="w-full rounded-lg border border-border bg-transparent py-2 pr-3 pl-9 text-sm outline-none focus:border-brand"
          />
        </div>
      </form>
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-medium">{fullName}</div>
          <div className="text-xs text-muted-foreground capitalize">{role}</div>
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
