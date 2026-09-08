"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

// How many copies of the invoice to lay out on one printed sheet.
const OPTIONS = [1, 2, 3] as const;

export default function PerSheetControl({ current }: { current: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(n: number) {
    const next = new URLSearchParams(params);
    if (n === 1) next.delete("per");
    else next.set("per", String(n));
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-border p-0.5 text-sm">
      <span className="px-2 text-xs text-muted-foreground">Per sheet</span>
      {OPTIONS.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => set(n)}
          className={`h-7 w-7 rounded-full font-medium ${
            current === n ? "bg-brand text-black" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
