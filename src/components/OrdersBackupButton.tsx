"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { exportOrdersBackupAction } from "@/app/(app)/orders/actions";

type Format = "xlsx" | "csv";

// Downloads a backup of every order (all statuses, one row per item) -- the whole
// history, not just the page of the table that is on screen. Excel is the one to
// read; CSV is the flat technical copy, of the orders in the From / To dates picked on the page
// (every order when no dates are picked, i.e. "All time").
export default function OrdersBackupButton({ from = "", to = "" }: { from?: string; to?: string }) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function backup(format: Format) {
    setBusy(format);
    setMessage(null);
    try {
      const { filename, mime, base64, orderCount } = await exportOrdersBackupAction(format, format === "csv" && (from || to) ? { from, to } : undefined);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ text: `Saved ${orderCount} order${orderCount === 1 ? "" : "s"} to ${filename}`, error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Backup failed", error: true });
    } finally {
      setBusy(null);
    }
  }

  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {message && (
        <span className={`text-xs ${message.error ? "text-red-500" : "text-muted-foreground"}`}>{message.text}</span>
      )}
      <button
        type="button"
        onClick={() => backup("xlsx")}
        disabled={busy !== null}
        title="Download every order as an Excel file, laid out to read"
        className={buttonClass}
      >
        {busy === "xlsx" ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
        {busy === "xlsx" ? "Preparing…" : "Backup Excel"}
      </button>
      <button
        type="button"
        onClick={() => backup("csv")}
        disabled={busy !== null}
        title={
          from || to
            ? `Download the orders from ${from || "the start"} to ${to || "today"} as a CSV file (one row per order)`
            : "Download every order as a CSV file (one row per order)"
        }
        className={buttonClass}
      >
        {busy === "csv" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {busy === "csv" ? "Preparing…" : "CSV"}
      </button>
    </div>
  );
}
