"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { deleteOrderAction } from "@/app/(app)/orders/actions";
import { notifyOrdersChanged } from "@/lib/ordersChanged";

// The delete-confirmation modal on its own, so it can be mounted by whatever
// owns the open state -- a per-row button, or the row's "…" menu (which
// unmounts its own contents when it closes, so it can't host the dialog).
// Mount it only while confirming: `{confirming && <DeleteOrderDialog … />}`.
export default function DeleteOrderDialog({
  orderId,
  onClose,
  // Where to send the user after a successful delete -- needed on the order
  // detail/invoice pages, which 404 once their own order is gone. Omit on a
  // list page, where refreshing in place is enough.
  redirectTo,
}: {
  orderId: string;
  onClose: () => void;
  redirectTo?: string;
}) {
  const router = useRouter();
  // Starts false so the dialog fades/scales in on mount rather than snapping
  // to full opacity -- flipped a frame later.
  const [visible, setVisible] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteOrderAction(orderId);
        notifyOrdersChanged();
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
          onClose();
        }
      } catch {
        setError("Failed to delete");
      }
    });
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        if (!isPending) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-order-title"
        aria-describedby="delete-order-description"
        className={`w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl transition-all duration-150 ${
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
          <TriangleAlert className="h-6 w-6" />
        </div>
        <h2 id="delete-order-title" className="mt-4 text-base font-semibold text-foreground">
          Delete this invoice?
        </h2>
        <p id="delete-order-description" className="mt-1.5 text-sm text-muted-foreground">
          This deletes the order and restores the stock it consumed. This can&apos;t be undone.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDelete}
            className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
