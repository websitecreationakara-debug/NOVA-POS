"use client";

// A webpage can't skip past the browser's print dialog to save a file
// directly -- so for a real one-click "Save as PDF" (no dialog at all) this
// renders each invoice sheet to a canvas and assembles an actual PDF file
// that downloads immediately. html2canvas-pro (not the unmaintained
// html2canvas) is required: Tailwind v4's default palette uses oklch()
// colors, which plain html2canvas can't parse and throws on.
export async function exportInvoicePdf(filename: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  // Only the first duplicate-voucher copy of each order -- a saved PDF
  // doesn't need the second "shop copy" a printed voucher does (see
  // data-copy on the invoice pages).
  const sheets = Array.from(
    document.querySelectorAll<HTMLElement>('.invoice-sheet[data-copy="1"]')
  );
  if (sheets.length === 0) return;

  const PAGE_W_MM = 210;
  const PAGE_H_MM = 297;
  const MARGIN_MM = 6; // matches the print stylesheet's @page margin
  const availW = PAGE_W_MM - MARGIN_MM * 2;
  const availH = PAGE_H_MM - MARGIN_MM * 2;
  const PX_TO_MM = 25.4 / 96;

  const pdf = new jsPDF({ unit: "mm", format: "a4" });

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    // The on-screen sheet can be `zoom`-shrunk to keep a long invoice on one
    // printed page (see InvoiceDoc's pageFit). html2canvas-pro mis-renders
    // text spacing under CSS zoom < 1 (letters run together with no
    // spacing) -- verified against this exact invoice layout -- so capture
    // at natural size instead and scale the resulting image, never the DOM,
    // to fit the page.
    const zoomEl = sheet.firstElementChild as HTMLElement | null;
    const prevZoom = zoomEl?.style.zoom ?? "";
    const prevBorder = sheet.style.border;
    const prevShadow = sheet.style.boxShadow;
    const prevRadius = sheet.style.borderRadius;
    if (zoomEl) zoomEl.style.zoom = "1";
    // Drop the on-screen card chrome (border/shadow/rounded corners) so the
    // page image matches the clean printed sheet instead of the browser
    // preview card.
    sheet.style.border = "none";
    sheet.style.boxShadow = "none";
    sheet.style.borderRadius = "0";

    const rect = sheet.getBoundingClientRect();
    const naturalWmm = rect.width * PX_TO_MM;
    const naturalHmm = rect.height * PX_TO_MM;

    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(sheet, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
    } finally {
      if (zoomEl) zoomEl.style.zoom = prevZoom;
      sheet.style.border = prevBorder;
      sheet.style.boxShadow = prevShadow;
      sheet.style.borderRadius = prevRadius;
    }

    // Never upscale a short invoice past its natural size -- only shrink a
    // sheet taller/wider than one page, same intent as pageFit above but as
    // an image scale (safe) instead of a DOM zoom (breaks text spacing).
    const scale = Math.min(availW / naturalWmm, availH / naturalHmm, 1);
    const drawW = naturalWmm * scale;
    const drawH = naturalHmm * scale;
    const x = MARGIN_MM + (availW - drawW) / 2;
    const y = MARGIN_MM;

    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, drawW, drawH);
  }

  const safeName = filename.replace(/[\\/:*?"<>|]/g, "-");
  pdf.save(`${safeName}.pdf`);
}
