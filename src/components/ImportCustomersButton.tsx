"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, Upload, X } from "lucide-react";
import { importCustomersAction } from "@/app/(app)/marketing/actions";
import {
  customerCsvTemplate,
  parseCustomerCsv,
  type CustomerImportError,
  type ParsedCustomerCsv,
} from "@/lib/customerCsv";

// Rows per server call -- keeps each request comfortably under the Server
// Action body-size limit however big the file is.
const BATCH = 500;

type Totals = { created: number; updated: number; errors: CustomerImportError[] };
type Stage = "preview" | "importing" | "done";

// "Import CSV" on the Marketing customers card: pick a file -> preview what
// would happen (new / updated / skipped, nothing written yet) -> confirm.
export default function ImportCustomersButton() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCustomerCsv | null>(null);
  const [preview, setPreview] = useState<Totals | null>(null);
  const [stage, setStage] = useState<Stage>("preview");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const open = parsed !== null;

  function close() {
    if (busy) return;
    setParsed(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setStage("preview");
    setVisible(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) close();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  // Runs every batch through the server action and adds up the answers.
  async function run(rows: ParsedCustomerCsv["rows"], commit: boolean): Promise<Totals> {
    const totals: Totals = { created: 0, updated: 0, errors: [] };
    for (let i = 0; i < rows.length; i += BATCH) {
      const r = await importCustomersAction(rows.slice(i, i + BATCH), commit);
      totals.created += r.created;
      totals.updated += r.updated;
      totals.errors.push(...r.errors);
    }
    return totals;
  }

  async function onFile(file: File) {
    setError(null);
    setFileName(file.name);
    setStage("preview");
    setResult(null);
    setPreview(null);
    const p = parseCustomerCsv(await file.text());
    setParsed(p);
    if (p.fatal || p.rows.length === 0) return;
    setBusy(true);
    try {
      setPreview(await run(p.rows, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check the file");
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    setStage("importing");
    try {
      setResult(await run(parsed.rows, true));
      setStage("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setStage("preview");
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([customerCsvTemplate()], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "customers-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const fileErrors = parsed?.errors ?? [];
  const serverErrors = (stage === "done" ? result?.errors : preview?.errors) ?? [];
  const allProblems = [...fileErrors, ...serverErrors];
  const skipped = fileErrors.length + serverErrors.length;
  const warnings = parsed?.warnings ?? [];

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
      >
        <Upload className="size-4" />
        Import CSV
      </button>

      {open && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 transition-opacity duration-150 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-customers-title"
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl transition-all duration-150 ${
              visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="import-customers-title" className="text-base font-semibold">
                  Import customers from CSV
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{fileName}</p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <X className="size-4" />
              </button>
            </div>

            {parsed?.fatal ? (
              <p className="mt-4 text-sm text-red-600">{parsed.fatal}</p>
            ) : parsed && parsed.rows.length === 0 ? (
              <p className="mt-4 text-sm text-red-600">No usable customer rows in this file.</p>
            ) : stage === "done" && result ? (
              <div className="mt-4 flex items-start gap-3 rounded-xl bg-success-bg p-4 text-sm text-success">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">Import finished</p>
                  <p>
                    {result.created} customer{result.created === 1 ? "" : "s"} added ·{" "}
                    {result.updated} updated · {skipped} skipped
                  </p>
                </div>
              </div>
            ) : busy && !preview ? (
              <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Checking the file…
              </p>
            ) : preview ? (
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-muted p-3">
                  <p className="text-2xl font-bold">{preview.created}</p>
                  <p className="text-xs text-muted-foreground">new customers</p>
                </div>
                <div className="rounded-xl bg-muted p-3">
                  <p className="text-2xl font-bold">{preview.updated}</p>
                  <p className="text-xs text-muted-foreground">already exist — will be updated</p>
                </div>
                <div className="rounded-xl bg-muted p-3">
                  <p className="text-2xl font-bold">{skipped}</p>
                  <p className="text-xs text-muted-foreground">skipped</p>
                </div>
              </div>
            ) : null}

            {parsed && !parsed.fatal && parsed.recognizedColumns.length > 0 && stage !== "done" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Columns found: {parsed.recognizedColumns.join(", ")}
              </p>
            )}

            {parsed && parsed.ignoredColumns.length > 0 && stage !== "done" && (
              <p className="mt-1 text-xs text-warning">
                Not imported (no matching field): {parsed.ignoredColumns.join(", ")}
              </p>
            )}

            {allProblems.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Skipped rows
                </p>
                <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-xs text-red-600">
                  {allProblems.slice(0, 50).map((p, i) => (
                    <li key={i}>
                      Row {p.row}: {p.message}
                    </li>
                  ))}
                  {allProblems.length > 50 && <li>…and {allProblems.length - 50} more</li>}
                </ul>
              </div>
            )}
            {warnings.length > 0 && stage !== "done" && (
              <div className="mt-3">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Notes
                </p>
                <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-xs text-warning">
                  {warnings.slice(0, 30).map((w, i) => (
                    <li key={i}>
                      Row {w.row}: {w.message}
                    </li>
                  ))}
                  {warnings.length > 30 && <li>…and {warnings.length - 30} more</li>}
                </ul>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            {stage !== "done" && preview && (
              <p className="mt-3 text-xs text-muted-foreground">
                Customers are matched by phone number. For ones that already exist, only the cells
                filled in your file are changed — blank cells never erase existing data.
              </p>
            )}

            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={downloadTemplate}
                className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
              >
                <Download className="size-3.5" />
                Download template
              </button>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {stage === "done" ? "Close" : "Cancel"}
              </button>
              {stage !== "done" && (
                <button
                  type="button"
                  onClick={doImport}
                  disabled={busy || !preview || preview.created + preview.updated === 0}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-95 disabled:opacity-50"
                >
                  {stage === "importing" && <Loader2 className="size-4 animate-spin" />}
                  {stage === "importing"
                    ? "Importing…"
                    : preview
                      ? `Import ${preview.created + preview.updated} customers`
                      : "Import"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
