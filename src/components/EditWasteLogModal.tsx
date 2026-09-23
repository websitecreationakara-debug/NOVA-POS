"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { updateWasteLogAction } from "@/app/(app)/accountance/actions";
import type { WasteLogEntry } from "@/lib/supabase/queries";

// Editing a waste entry can't change which product it's for (see
// updateWasteLogAction -- it reverses the old quantity and logs a fresh
// entry, which needs to stay the same product to make sense as an "edit"
// rather than a delete + a different waste item).
export default function EditWasteLogModal({
  entry,
  onClose,
}: {
  entry: WasteLogEntry;
  onClose: () => void;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(String(entry.quantity));
  const [note, setNote] = useState(entry.reason);
  const [date, setDate] = useState(entry.createdAt.slice(0, 10));
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    qtyRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit() {
    const amount = parseFloat(qty);
    if (Number.isNaN(amount) || amount <= 0) {
      setError("Enter how many units were wasted");
      return;
    }
    if (!date) {
      setError("Choose a date");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateWasteLogAction({
          id: entry.id,
          quantity: amount,
          reason: note.trim() || "Waste",
          date,
        });
        router.refresh();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-waste-title"
        className={`flex w-full max-w-sm flex-col rounded-2xl border border-border bg-card shadow-2xl transition-all duration-150 ${
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/[.08] px-5 py-4 dark:border-white/[.145]">
          <div>
            <h2 id="edit-waste-title" className="text-base font-semibold text-foreground">
              Edit waste entry
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{entry.productName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded p-1 text-zinc-500 hover:bg-black/[.06] dark:hover:bg-white/[.1]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40 rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm dark:border-white/[.2]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Quantity wasted</span>
            <input
              ref={qtyRef}
              type="number"
              min={0}
              step="0.01"
              placeholder="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="w-32 rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm dark:border-white/[.2]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">
              Note<span className="ml-1 font-normal text-zinc-400">— optional</span>
            </span>
            <input
              type="text"
              placeholder="e.g. Dropped, expired, spoiled"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm dark:border-white/[.2]"
            />
          </label>
        </div>

        {error && <p className="px-5 pb-2 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-black/[.08] px-5 py-4 dark:border-white/[.145]">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={submit}
            className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-black transition-colors hover:brightness-95 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
