// Saves each invoice sheet on the page as a PNG file (lossless, so small
// Khmer text and thin table lines stay sharp). Same capture
// approach as exportInvoicePdf (html2canvas-pro for Tailwind v4's oklch()
// colors; the sheet is captured at natural size, never under CSS zoom, which
// garbles text spacing) -- only the output differs: an image download per
// invoice instead of pages in a PDF. A bulk page produces one file per
// invoice, named after its invoice number.
import { captureInvoiceSheet, withInvoicesAtFullSize } from "./invoiceCapture";

// The sheets may be shown shrunk-to-fit on a phone; capture them at full size.
export function exportInvoiceImage(
  filename: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  return withInvoicesAtFullSize(() => saveInvoiceImages(filename, onProgress));
}

async function saveInvoiceImages(
  filename: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const { default: html2canvas } = await import("html2canvas-pro");

  // Same selection rules as the PDF export: first copy of each order only, and
  // skip Next.js's display:none streaming duplicates (offsetParent === null).
  const sheets = Array.from(
    document.querySelectorAll<HTMLElement>('.invoice-sheet[data-copy="1"]')
  ).filter((el) => el.offsetParent !== null);
  if (sheets.length === 0) return;

  const safeName = filename.replace(/[\\/:*?"<>|]/g, "-");
  const usedNames = new Set<string>();
  // Invoices that still couldn't be drawn correctly after retrying -- no file is
  // saved for them (a bad picture is worse than none) and they're reported at the end.
  const failed: string[] = [];

  for (let i = 0; i < sheets.length; i++) {
    onProgress?.(i, sheets.length);
    // Let the page paint (progress text, buttons) between the heavy captures so a
    // large batch doesn't freeze the tab.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sheet = sheets[i];
    const invoiceName = sheet.dataset.invoice?.replace(/[\\/:*?"<>|]/g, "-");
    const zoomEl = sheet.firstElementChild as HTMLElement | null;
    const prevZoom = zoomEl?.style.zoom ?? "";
    const prevBorder = sheet.style.border;
    const prevShadow = sheet.style.boxShadow;
    const prevRadius = sheet.style.borderRadius;
    if (zoomEl) zoomEl.style.zoom = "1";
    // Drop the on-screen card chrome so the image matches the clean printed sheet.
    sheet.style.border = "none";
    sheet.style.boxShadow = "none";
    sheet.style.borderRadius = "0";

    let canvas: HTMLCanvasElement | null = null;
    try {
      canvas = await captureInvoiceSheet(html2canvas, sheet, invoiceName || `#${i + 1}`);
    } catch {
      failed.push(invoiceName || `#${i + 1}`);
    } finally {
      if (zoomEl) zoomEl.style.zoom = prevZoom;
      sheet.style.border = prevBorder;
      sheet.style.boxShadow = prevShadow;
      sheet.style.borderRadius = prevRadius;
    }
    if (!canvas) continue;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    // Release the canvas's pixel memory now (each is ~12 MB) rather than waiting
    // for the garbage collector -- they pile up over a large batch.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) {
      failed.push(invoiceName || `#${i + 1}`);
      continue;
    }

    // Each file is named after its invoice number when the sheet carries one
    // (data-invoice on the bulk page), e.g. "202610-12.png"; otherwise the
    // old "<name>-<n>" numbering.
    let fileName = invoiceName || `${safeName}${sheets.length > 1 ? `-${i + 1}` : ""}`;
    for (let n = 2; usedNames.has(fileName); n++) fileName = `${invoiceName || safeName}-${n}`;
    usedNames.add(fileName);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.png`;
    a.click();
    // Not revoked straight away: a revoked URL can cancel a download the browser
    // hasn't started reading yet, which matters when many files are queued.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  onProgress?.(sheets.length, sheets.length);

  if (failed.length > 0) {
    throw new Error(
      `${failed.length} invoice${failed.length === 1 ? "" : "s"} couldn't be drawn correctly and ` +
        `${failed.length === 1 ? "was" : "were"} not saved: ${failed.join(", ")}. Click Save as PNG again to retry.`
    );
  }
}
