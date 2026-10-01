// Reads a customer table out of a PDF printout of the customer sheet (the same
// columns as the CSV) and hands it back as rows of cells, ready for
// parseCustomerTable. Runs in the browser -- these PDFs are several MB, far
// past what a Server Action accepts.
//
// pdf.js's normal text extraction glues neighbouring cells together
// ("85512500064 Veasna Chou Chou"), so this reads the lower-level text
// drawing commands instead: each cell (or piece of one) is its own run with an
// exact position. Runs that touch end to end are one cell (a long address is
// drawn in many pieces); each cell then goes to the column whose heading it
// sits under, and to the row whose phone number is nearest below it (rows are
// bottom-aligned, so extra address lines sit above the phone).

import { isKnownCustomerHeader } from "@/lib/customerCsv";

type Pdfjs = typeof import("pdfjs-dist");

type Run = { s: string; x: number; y: number; adv: number };
type Cell = { s: string; x: number; y: number; endX: number };

const mul = (m: number[], n: number[]) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

// Private-use glyphs (emoji/symbol fonts) come out as unreadable boxes.
const PRIVATE_USE = /[-]|[\u{F0000}-\u{10FFFF}]/gu;
// Numbers/dates are right-aligned, so one can end exactly where the next cell starts.
const NUMERIC = /^[\d/.+eE\-\s]+$/;

async function pageRuns(pdfjs: Pdfjs, page: Awaited<ReturnType<import("pdfjs-dist").PDFDocumentProxy["getPage"]>>): Promise<Run[]> {
  const { OPS } = pdfjs;
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let fontSize = 1;
  const runs: Run[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = ops.argsArray[i] as any;
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(Array.from(a as ArrayLike<number>), ctm);
    else if (fn === OPS.setFont) fontSize = a[1];
    else if (fn === OPS.beginText) tm = [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.setTextMatrix) {
      const m = typeof a[0] === "number" ? a : a[0];
      tm = [0, 1, 2, 3, 4, 5].map((k) => Number(m[k]));
    } else if (fn === OPS.moveText) tm = mul([1, 0, 0, 1, a[0], a[1]], tm);
    else if (fn === OPS.showText || fn === OPS.showSpacedText) {
      const full = mul(tm, ctm);
      const scale = Math.hypot(full[0], full[1]);
      let text = "";
      let width = 0; // thousandths of an em
      for (const g of a[0] as unknown[]) {
        if (typeof g === "number") width -= g; // TJ kerning adjustment
        else {
          const glyph = g as { unicode?: string; width?: number };
          text += glyph.unicode ?? "";
          width += glyph.width ?? 0;
        }
      }
      if (text) runs.push({ s: text, x: full[4], y: full[5], adv: (width / 1000) * fontSize * scale });
    }
  }
  return runs;
}

/** Runs that touch end to end on one line are pieces of the same cell. */
function chainRuns(runs: Run[], anchors: number[] | null): Cell[] {
  const cells: Cell[] = [];
  let cur: Cell | null = null;
  const nearAnchor = (x: number) => !!anchors?.some((a) => Math.abs(a - x) < 0.9);
  for (const r of runs) {
    const continues =
      cur &&
      Math.abs(r.y - cur.y) < 3 &&
      Math.abs(cur.endX - r.x) < 0.9 &&
      // a right-aligned number ending exactly at the next column's start is not part of that column
      !(NUMERIC.test(cur.s.trim()) && (anchors ? nearAnchor(r.x) : false));
    if (continues && cur) {
      cur.s += r.s;
      cur.endX = r.x + r.adv;
    } else {
      cur = { s: r.s, x: r.x, y: r.y, endX: r.x + r.adv };
      cells.push(cur);
    }
  }
  return cells;
}

export async function extractCustomerTableFromPdf(
  data: ArrayBuffer,
  opts: { pdfjs?: Pdfjs; onProgress?: (done: number, total: number) => void } = {}
): Promise<string[][]> {
  let pdfjs = opts.pdfjs;
  if (!pdfjs) {
    pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  }

  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await task.promise;
  try {
    let headers: string[] = [];
    let anchors: number[] = []; // x where each column's heading starts
    const rows: string[][] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      let cells = chainRuns(await pageRuns(pdfjs, page), anchors.length ? anchors : null);
      cells = cells
        .map((c) => ({ ...c, s: c.s.replace(PRIVATE_USE, "").trim() }))
        .filter((c) => c.s);

      if (p === 1) {
        // The heading row is the topmost line; its cells fix the column positions.
        const topY = Math.max(...cells.map((c) => c.y));
        const head = cells.filter((c) => Math.abs(c.y - topY) < 3).sort((a, b) => a.x - b.x);
        if (head.filter((c) => isKnownCustomerHeader(c.s)).length < 3) {
          throw new Error(
            "Couldn't find the customer column headings (Phone Number, Customer Name, …) at the top of the first page."
          );
        }
        headers = head.map((c) => c.s);
        anchors = head.map((c) => c.x);
        cells = cells.filter((c) => Math.abs(c.y - topY) >= 3);
        // Cells were chained before the column starts were known; re-chain the
        // page so a number ending at a column boundary isn't glued to the next cell.
        cells = chainRuns(
          await pageRuns(pdfjs, page),
          anchors
        )
          .map((c) => ({ ...c, s: c.s.replace(PRIVATE_USE, "").trim() }))
          .filter((c) => c.s && Math.abs(c.y - topY) >= 3);
      }
      if (anchors.length === 0) continue;

      const colOf = (x: number) => {
        let c = 0;
        anchors.forEach((a, i) => {
          if (x >= a - 3) c = i;
        });
        return c;
      };

      // Row anchors: the phone cell of each row (else the name cell).
      const phoneCol = headers.findIndex((h) => /phone/i.test(h) && !/2nd|second/i.test(h));
      const nameCol = headers.findIndex((h) => /name/i.test(h) && !/first|last/i.test(h));
      const rowYs: number[] = [];
      for (const c of cells) if (colOf(c.x) === phoneCol && /^[\d+eE.\s]+$/.test(c.s)) rowYs.push(c.y);
      for (const c of cells) {
        if (colOf(c.x) === nameCol && !rowYs.some((y) => Math.abs(y - c.y) < 3.5)) rowYs.push(c.y);
      }
      rowYs.sort((a, b) => b - a);

      const pageRows = rowYs.map((y) => ({
        y,
        parts: headers.map(() => [] as Cell[]),
      }));
      for (const c of cells) {
        // nearest row at or just below the cell (extra lines sit above the phone)
        let best = -1;
        let bestGap = Infinity;
        pageRows.forEach((r, i) => {
          const gap = c.y - r.y;
          if (gap >= -3.5 && gap < bestGap) {
            bestGap = gap;
            best = i;
          }
        });
        if (best < 0 || bestGap > 60) continue;
        pageRows[best].parts[colOf(c.x)].push(c);
      }
      for (const r of pageRows) {
        rows.push(
          r.parts.map((parts) => {
            parts.sort((a, b) => b.y - a.y || a.x - b.x);
            let out = "";
            parts.forEach((c, i) => {
              if (i > 0) out += Math.abs(parts[i - 1].y - c.y) > 3 ? "\n" : " ";
              out += c.s;
            });
            return out;
          })
        );
      }
      opts.onProgress?.(p, doc.numPages);
    }

    return [headers, ...rows];
  } finally {
    await task.destroy();
  }
}
