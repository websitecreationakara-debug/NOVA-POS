"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import ThemeToggle from "@/components/ThemeToggle";

export default function TopBar({ fullName, role }: { fullName: string; role: string }) {
  return (
    <header className="print:hidden flex shrink-0 items-center gap-4 border-b border-border bg-card px-6 py-3">
      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
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
