"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, MoreHorizontal, Printer, Trash2 } from "lucide-react";
import DeleteOrderDialog from "./DeleteOrderDialog";

// The per-row "…" actions menu on the orders list. Groups the secondary
// actions (view / print / delete) behind one control so a destructive button
// isn't sitting exposed on every row. The popover is position:fixed so the
// table's own scroll container can't clip it. The delete dialog lives outside
// the popover so closing the menu doesn't unmount it mid-flow.
export default function OrderRowMenu({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function place() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    place();
    function onDoc(e: MouseEvent) {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-black/[.05] dark:hover:bg-white/[.08]";

  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Order actions"
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 50 }}
          className="min-w-[10rem] overflow-hidden rounded-lg border border-border bg-card py-1 text-xs shadow-lg"
        >
          <Link
            href={`/orders/${orderId}`}
            role="menuitem"
            className={`${itemClass} text-foreground`}
          >
            <Eye className="size-3.5 shrink-0" />
            View details
          </Link>
          <Link
            href={`/invoice/${orderId}`}
            role="menuitem"
            className={`${itemClass} text-foreground`}
          >
            <Printer className="size-3.5 shrink-0" />
            Print invoice
          </Link>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmDelete(true);
            }}
            className={`${itemClass} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40`}
          >
            <Trash2 className="size-3.5 shrink-0" />
            Delete
          </button>
        </div>
      )}

      {confirmDelete && (
        <DeleteOrderDialog orderId={orderId} onClose={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}
