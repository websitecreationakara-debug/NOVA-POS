"use client";

import { useState } from "react";
import { Download, Image as ImageIcon, Loader2, Printer } from "lucide-react";
import { exportInvoicePdf } from "@/lib/exportInvoicePdf";
import { exportInvoiceImage } from "@/lib/exportInvoiceImage";

export default function PrintButton({ filename }: { filename?: string }) {
  const [exporting, setExporting] = useState(false);
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
      await exportInvoiceImage(filename || "Invoice");
    } catch (error) {
      console.error("Image export failed", error);
      alert("Couldn't generate the image. Try Save as PDF instead.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="print:hidden flex items-center gap-2">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04] dark:hover:bg-white/[.06]"
      >
        <Printer className="size-4" />
        Print
      </button>
      <button
        onClick={handleSaveAsPdf}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {exporting ? "Generating…" : "Save as PDF"}
      </button>
      <button
        onClick={handleSaveAsImage}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-black/[.04] disabled:opacity-60 dark:hover:bg-white/[.06]"
      >
        <ImageIcon className="size-4" />
        Save as PNG
      </button>
    </div>
  );
}
