"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import ThemeToggle from "@/components/ThemeToggle";
import { staffRoleLabel } from "@/types/database";

export default function TopBar({ fullName, role }: { fullName: string; role: string }) {
  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  return (
    <header className="print:hidden flex shrink-0 items-center gap-3 border-b border-border bg-card px-6 py-3">
      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <div className="flex items-center gap-2.5 rounded-full border border-border bg-muted/60 py-1 pr-3 pl-1">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/20 text-xs font-bold text-brand">
            {initials}
          </span>
          <div className="leading-tight">
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
