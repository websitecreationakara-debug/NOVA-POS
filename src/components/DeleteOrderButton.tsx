"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrderAction } from "@/app/(app)/orders/actions";

export default function DeleteOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteOrderAction(orderId);
        router.refresh();
      } catch {
        setError("Failed to delete");
        setConfirming(false);
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {confirming ? (
        <>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDelete}
            className="rounded border border-red-500 px-2 py-1 text-xs text-red-500 disabled:opacity-50"
          >
            {isPending ? "…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded border border-black/[.15] px-2 py-1 text-xs dark:border-white/[.2]"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded border border-black/[.15] px-2 py-1 text-xs text-red-500 dark:border-white/[.2]"
        >
          Delete
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
