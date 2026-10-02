// html2canvas lays out a cloned copy of the invoice sheet, and there an image
// that is sized only by a height class (the letterhead logo: `h-24 w-auto
// max-w-[55%]`) can lose that size and fall back to its natural pixels. A logo
// file that is thousands of pixels wide (sora-sake.png is 4000x2328) then
// stretches the whole sheet and shrinks the invoice into one corner of a huge
// image. Measure every image as it is on screen and pin the clone's copy to
// exactly that size, so each saved invoice looks like the printed one.
// Call after the sheet is set up for capture (zoom reset), and pass the result
// to html2canvas as `onclone`.
export function pinImageSizes(sheet: HTMLElement): (doc: Document, cloned: HTMLElement) => void {
  const sizes = Array.from(sheet.querySelectorAll("img")).map((img) => {
    const rect = img.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  });
  return (_doc, cloned) => {
    cloned.querySelectorAll("img").forEach((img, i) => {
      const size = sizes[i];
      if (!size || size.w === 0 || size.h === 0) return;
      img.style.width = `${size.w}px`;
      img.style.height = `${size.h}px`;
      img.style.maxWidth = "none";
      img.style.maxHeight = "none";
    });
  };
}
