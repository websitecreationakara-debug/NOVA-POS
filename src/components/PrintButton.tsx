"use client";

import { Download, Printer } from "lucide-react";

export default function PrintButton({ filename }: { filename?: string }) {
  // Same window.print() dialog either way -- a webpage can't skip straight
  // to a saved file, the user still has to pick "Save as PDF" as the
  // destination there. The only real thing we control is the filename that
  // dialog suggests, via document.title -- set it only for the "Save as
  // PDF" click so a plain "Print" doesn't retitle the tab for a physical
  // printer that ignores it anyway. Restored on "afterprint" (fires once the
  // dialog closes, print or cancel), with a timeout fallback for browsers
  // that don't fire it for a print-to-file destination.
  function printAs(newTitle?: string) {
    if (!newTitle) {
      window.print();
      return;
    }
    const original = document.title;
    document.title = newTitle;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.title = original;
    };
    window.addEventListener("afterprint", restore, { once: true });
    setTimeout(restore, 2000);
    window.print();
  }

  return (
    <div className="print:hidden flex items-center gap-2">
      <button
        onClick={() => printAs()}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04] dark:hover:bg-white/[.06]"
      >
        <Printer className="size-4" />
        Print
      </button>
      <button
        onClick={() => printAs(filename || "Invoice")}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-black"
      >
        <Download className="size-4" />
        Save as PDF
      </button>
    </div>
  );
}
