"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import DeleteOrderDialog from "./DeleteOrderDialog";

export default function DeleteOrderButton({
  orderId,
  // Where to send the user after a successful delete -- needed on the order
  // detail/invoice pages, which 404 once their own order is gone. Omit on a
  // list page, where refreshing in place is enough.
  redirectTo,
  // "button" (default) = bordered text button; "icon" = bare trash icon.
  variant = "button",
}: {
  orderId: string;
  redirectTo?: string;
  variant?: "button" | "icon";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          title="Delete order"
          aria-label="Delete order"
          className="inline-flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Trash2 className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="rounded border border-black/[.15] px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 dark:border-white/[.2] dark:hover:bg-red-950/40"
        >
          Delete
        </button>
      )}

      {open && (
        <DeleteOrderDialog
          orderId={orderId}
          onClose={() => setOpen(false)}
          redirectTo={redirectTo}
        />
      )}
    </>
  );
}
