"use client";

import { Download, Printer } from "lucide-react";

export default function PrintButton({ filename }: { filename?: string }) {
  // Same window.print() dialog either way -- a webpage can't skip straight
  // to a saved file, the user still has to pick "Save as PDF" as the
  // destination there. What we do control: the suggested filename (via
  // document.title) and, for "Save as PDF" only, dropping the second
  // duplicate-voucher copy (via a body class -- see globals.css) since a
  // saved PDF doesn't need a "shop copy" the way a printed voucher does.
  // Both are set right before printing and restored on "afterprint" (fires
  // once the dialog closes, print or cancel), with a timeout fallback for
  // browsers that don't fire it for a print-to-file destination.
  function printAs({ title, singleCopy }: { title?: string; singleCopy?: boolean } = {}) {
    const originalTitle = document.title;
    if (title) document.title = title;
    if (singleCopy) document.body.classList.add("pdf-single-copy");

    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      if (title) document.title = originalTitle;
      if (singleCopy) document.body.classList.remove("pdf-single-copy");
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
        onClick={() => printAs({ title: filename || "Invoice", singleCopy: true })}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-black"
      >
        <Download className="size-4" />
        Save as PDF
      </button>
    </div>
  );
}
