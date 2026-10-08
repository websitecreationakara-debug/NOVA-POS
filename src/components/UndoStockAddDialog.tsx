"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { undoStockAddAction } from "@/app/(app)/accountance/actions";

// Same look/behavior as DeleteWasteLogDialog/DeleteExpenseDialog --
// mount only while confirming: `{confirming && <UndoStockAddDialog … />}`.
export default function UndoStockAddDialog({
  productId,
  productName,
  quantity,
  onClose,
}: {
  productId: string;
  productName: string;
  quantity: number;
  onClose: () => void;
}) {
  const router = useRouter();
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

  function handleUndo() {
    startTransition(async () => {
      try {
        await undoStockAddAction({ productId, quantity });
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to undo");
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
        aria-labelledby="undo-stock-title"
        aria-describedby="undo-stock-description"
        className={`w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl transition-all duration-150 ${
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
          <TriangleAlert className="h-6 w-6" />
        </div>
        <h2 id="undo-stock-title" className="mt-4 text-base font-semibold text-foreground">
          Undo this stock add?
        </h2>
        <p id="undo-stock-description" className="mt-1.5 text-sm text-muted-foreground">
          {quantity} unit{quantity === 1 ? "" : "s"} of &quot;{productName}&quot; will be taken back out of
          stock and no longer count as purchased. This can&apos;t be undone.
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
            onClick={handleUndo}
            className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Undoing…" : "Undo"}
          </button>
        </div>
      </div>
    </div>
  );
}
