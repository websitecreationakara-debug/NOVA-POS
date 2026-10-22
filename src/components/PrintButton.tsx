"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon, Loader2, Printer } from "lucide-react";
import { exportInvoicePdf } from "@/lib/exportInvoicePdf";
import { exportInvoiceImage } from "@/lib/exportInvoiceImage";

// Waits for the web fonts and pictures, so the print preview isn't taken half-loaded.
async function whenLoaded() {
  const images = Array.from(document.images).filter((img) => !img.complete);
  await Promise.race([
    Promise.all([
      document.fonts?.ready,
      ...images.map((img) => new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      })),
    ]),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
}

export default function PrintButton({ filename }: { filename?: string }) {
  // True in the tab Print opened (?autoprint=1): it prints right away, and its own
  // Print button prints here instead of opening yet another tab.
  const inPrintTab = useRef(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("autoprint") !== "1") return;
    inPrintTab.current = true;
    url.searchParams.delete("autoprint");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
    void whenLoaded().then(() => window.print());
  }, []);

  // Print opens the invoice in a new tab and prints it there.
  function handlePrint() {
    if (inPrintTab.current) {
      window.print();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("autoprint", "1");
    const link = document.createElement("a");
    link.href = url.pathname + url.search;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }

  const [exporting, setExporting] = useState(false);
  // "Saving 12 of 54" while a PNG batch runs -- a big batch takes a while.
  const [imageProgress, setImageProgress] = useState<string | null>(null);
  async function handleSaveAsPdf() {
    setExporting(true);
    try {
      await exportInvoicePdf(filename || "Invoice");
    } catch (error) {
      console.error("PDF export failed", error);
      alert("Couldn't generate the PDF. Try Print instead and choose \"Save as PDF\" there.");
    } finally {
      setExporting(false);
    }
  }

  async function handleSaveAsImage() {
    setExporting(true);
    try {
      await exportInvoiceImage(filename || "Invoice", (done, total) =>
        setImageProgress(total > 1 ? `Saving ${Math.min(done + 1, total)} of ${total}…` : null)
      );
    } catch (error) {
      console.error("Image export failed", error);
      // A failed batch names the invoices that weren't saved; anything else gets
      // the generic hint.
      alert(
        error instanceof Error && error.message.includes("not saved")
          ? error.message
          : "Couldn't generate the image. Try Save as PDF instead."
      );
    } finally {
      setExporting(false);
      setImageProgress(null);
    }
  }

  return (
    <div className="print:hidden flex flex-wrap items-center justify-center gap-2">
      <button
        onClick={handlePrint}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium whitespace-nowrap hover:bg-black/[.04] dark:hover:bg-white/[.06]"
      >
        <Printer className="size-4" />
        Print
      </button>
      <button
        onClick={handleSaveAsPdf}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium whitespace-nowrap text-white disabled:opacity-60"
      >
        {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {exporting ? "Generating…" : "Save as PDF"}
      </button>
      <button
        onClick={handleSaveAsImage}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium whitespace-nowrap hover:bg-black/[.04] disabled:opacity-60 dark:hover:bg-white/[.06]"
      >
        {exporting && imageProgress ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
        {exporting && imageProgress ? imageProgress : "Save as PNG"}
      </button>
    </div>
  );
}
