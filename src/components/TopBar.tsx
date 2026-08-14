"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User } from "lucide-react";

export default function TopBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/sales?q=${encodeURIComponent(q)}` : "/sales");
  }

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-6 py-3">
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
      <div className="ml-auto grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
        <User className="size-4" />
      </div>
    </header>
  );
}
