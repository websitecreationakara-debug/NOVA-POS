"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type DropdownOption = { value: string; label: string };

// A click-to-open dropdown that replaces the native <select> where its
// OS-drawn option list can't be themed -- on Windows the native popup stays
// white with near-invisible grey text in dark mode however `color-scheme` is
// set. This one is plain DOM, so it follows the app's own light/dark tokens.
export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = "Select…",
  className = "",
  disabled = false,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded border border-black/[.15] bg-card px-2.5 py-1.5 text-left text-sm text-foreground outline-none focus:border-black/40 disabled:opacity-50 dark:border-white/[.2] dark:focus:border-white/50"
      >
        <span className={selected ? "truncate" : "truncate text-zinc-400"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full min-w-max overflow-auto rounded border border-black/[.15] bg-card py-1 text-sm shadow-lg dark:border-white/[.2]"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-black/[.05] dark:hover:bg-white/[.08] ${
                    active ? "font-medium text-brand" : "text-foreground"
                  }`}
                >
                  <span>{o.label}</span>
                  {active && <Check className="size-4 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
