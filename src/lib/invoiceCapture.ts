import type html2canvas from "html2canvas-pro";

// Shared set-up for turning an invoice sheet into an image (PNG or PDF page).
// html2canvas renders a cloned copy of the page inside a hidden iframe, and a few
// things can go wrong in that clone -- some of them only some of the time, which is
// why some saved invoices came out fine and others did not:
//
// 1. Missing styles. The clone's <link rel="stylesheet"> tags load from the
//    network after the clone is created; if the capture starts first, the
//    sheet is drawn with no CSS at all (plain serif text, no table, a
//    viewport-wide canvas). Fix: copy the page's CSS rules straight into the
//    clone as <style> so it is styled immediately.
// 2. Image sizes. An image sized only by a height class (the letterhead logo:
//    `h-24 w-auto max-w-[55%]`) can fall back to its natural pixels -- the Sora
//    Sake logo file is 4000x2328 -- and stretch the whole sheet. Fix: measure
//    every image as it is on screen and pin the clone's copy to that size.
// 3. Cost that grows with the batch. html2canvas clones the WHOLE page for every
//    sheet it draws. Fix: drop every other sheet from the clone.
//
// Even with those, a capture can still come out bare on some machines, so
// captureInvoiceSheet below checks the result and retries -- see there.

type CloneOptions = {
  // Last-resort mode: write every element's final, resolved style into the clone
  // as inline style, so the picture no longer depends on any stylesheet at all.
  inlineComputed?: boolean;
};

export function prepareInvoiceClone(
  sheet: HTMLElement,
  options: CloneOptions = {}
): (doc: Document, cloned: HTMLElement) => Promise<void> {
  const sizes = Array.from(sheet.querySelectorAll("img")).map((img) => {
    const rect = img.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  });
  const css = collectPageCss();
  const computed = options.inlineComputed ? collectComputedStyles(sheet) : null;

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

    if (computed) {
      // The clone is a copy of the sheet, so its elements line up one-to-one.
      const clonedEls = [cloned, ...Array.from(cloned.querySelectorAll<HTMLElement>("*"))];
      clonedEls.forEach((el, i) => {
        if (computed[i] !== undefined) el.style.cssText = computed[i];
      });
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

// On a narrow screen the invoice sheets are shown shrunk to fit (FitInvoices).
// html2canvas and the page-size maths read the sheet's on-screen size, so every
// capture has to run with that shrink switched off -- this puts the sheets back
// to their real size for the duration of `capture` and restores the preview after.
export async function withInvoicesAtFullSize<T>(capture: () => Promise<T>): Promise<T> {
  const wrappers = Array.from(document.querySelectorAll<HTMLElement>("[data-fit-wrapper]"));
  const saved = wrappers.map((w) => ({
    w,
    fit: w.style.getPropertyValue("--fit"),
    height: w.style.getPropertyValue("--fit-h"),
    overflow: w.style.overflow,
  }));
  for (const w of wrappers) {
    w.style.setProperty("--fit", "1");
    w.style.setProperty("--fit-h", "auto");
    w.style.overflow = "visible";
    void w.offsetHeight; // apply the layout now, before anything measures
  }
  try {
    return await capture();
  } finally {
    for (const s of saved) {
      if (s.fit) s.w.style.setProperty("--fit", s.fit);
      else s.w.style.removeProperty("--fit");
      if (s.height) s.w.style.setProperty("--fit-h", s.height);
      else s.w.style.removeProperty("--fit-h");
      s.w.style.overflow = s.overflow;
    }
  }
}

// Draws one invoice sheet to a canvas and makes sure it came out right. A sheet
// drawn without its styles is the wrong width (as wide as the browser window
// instead of the A4 sheet), which is cheap to detect -- so a bad capture is
// retried, waiting a little longer each time, and the last try uses inline
// computed styles that don't need the stylesheet at all. If it still isn't right
// this throws, so a bad picture is never saved -- the caller reports the invoice
// instead. Slower, but every saved image is a good one.
export async function captureInvoiceSheet(
  capture: typeof html2canvas,
  sheet: HTMLElement,
  label: string
): Promise<HTMLCanvasElement> {
  const SCALE = 2;
  const expectedWidth = Math.round(sheet.getBoundingClientRect().width * SCALE);
  const attempts = 3;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    const canvas = await capture(sheet, {
      scale: SCALE,
      backgroundColor: "#ffffff",
      useCORS: true,
      onclone: prepareInvoiceClone(sheet, { inlineComputed: attempt === attempts - 1 }),
    });
    if (Math.abs(canvas.width - expectedWidth) <= 4) return canvas;
    // Wrong size = drawn without its styles. Free it and try again.
    canvas.width = 0;
    canvas.height = 0;
  }
  throw new Error(`Invoice ${label} did not render correctly`);
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

// The resolved style of the sheet and every element in it, as inline CSS text,
// in document order.
function collectComputedStyles(sheet: HTMLElement): string[] {
  return [sheet, ...Array.from(sheet.querySelectorAll<HTMLElement>("*"))].map((el) => {
    const style = getComputedStyle(el);
    let text = "";
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      text += `${prop}:${style.getPropertyValue(prop)};`;
    }
    return text;
  });
}
