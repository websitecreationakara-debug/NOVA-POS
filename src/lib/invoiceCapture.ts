// Shared set-up for turning an invoice sheet into an image (PNG or PDF page).
// html2canvas renders a cloned copy of the page inside a hidden iframe, and two
// things can go wrong in that clone -- both only some of the time, which is why
// some saved invoices came out fine and others did not:
//
// 1. Missing styles. The clone's <link rel="stylesheet"> tags load from the
//    network after the clone is created; if the capture starts first, the
//    sheet is drawn with no CSS at all (plain text, no table, a viewport-wide
//    canvas). Fix: copy the page's CSS rules straight into the clone as <style>
//    so it is styled immediately, whether or not the links have loaded.
// 2. Image sizes. An image sized only by a height class (the letterhead logo:
//    `h-24 w-auto max-w-[55%]`) can fall back to its natural pixels -- the Sora
//    Sake logo file is 4000x2328 -- and stretch the whole sheet. Fix: measure
//    every image as it is on screen and pin the clone's copy to that size.
//
// 3. Cost that grows with the batch. html2canvas clones the WHOLE page for every
//    sheet it draws, so a bulk page with N invoices (2N sheets, both copies)
//    makes each capture do N times the work -- N invoices take N-squared time and
//    memory, and a big batch stalls or produces broken images. Fix: drop every
//    other sheet from the clone, so each capture only ever handles its own
//    invoice and the total grows in step with the number of invoices.
//
// Call after the sheet is set up for capture (zoom reset) and pass the result to
// html2canvas as `onclone`.
export function prepareInvoiceClone(
  sheet: HTMLElement
): (doc: Document, cloned: HTMLElement) => Promise<void> {
  const sizes = Array.from(sheet.querySelectorAll("img")).map((img) => {
    const rect = img.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  });
  const css = collectPageCss();

  return async (doc, cloned) => {
    // Only this sheet is needed in the clone (see 3 above).
    doc.querySelectorAll(".invoice-sheet").forEach((el) => {
      if (el !== cloned) el.remove();
    });

    if (css) {
      const style = doc.createElement("style");
      style.textContent = css;
      doc.head.appendChild(style);
    }

    cloned.querySelectorAll("img").forEach((img, i) => {
      const size = sizes[i];
      if (!size || size.w === 0 || size.h === 0) return;
      img.style.width = `${size.w}px`;
      img.style.height = `${size.h}px`;
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
    });

    // The web fonts (Hanuman for Khmer) must be ready before the first paint.
    try {
      await doc.fonts?.ready;
    } catch {
      /* draw with whatever is loaded */
    }
  };
}

// Every readable CSS rule on the page. A stylesheet from another origin can't be
// read (cssRules throws) and is skipped -- the invoice's own styles and the
// self-hosted fonts are all same-origin.
function collectPageCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      parts.push(Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n"));
    } catch {
      /* cross-origin sheet */
    }
  }
  return parts.join("\n");
}
