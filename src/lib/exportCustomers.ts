"use client";

import type { CustomerExportRow } from "@/app/(app)/marketing/actions";

// The columns of an export, in the CRM list's order.
const COLUMNS: { header: string; value: (r: CustomerExportRow) => string }[] = [
  { header: "Phone Number", value: (r) => r.phone },
  { header: "Customer Name", value: (r) => r.name },
  { header: "Orders", value: (r) => (r.orders === null ? "" : String(r.orders)) },
  { header: "Products", value: (r) => (r.products === null ? "" : String(r.products)) },
  { header: "Spent", value: (r) => (r.spent === null ? "" : r.spent.toFixed(2)) },
  { header: "Business", value: (r) => r.business },
  { header: "Email", value: (r) => r.email },
  { header: "Address", value: (r) => r.address },
  { header: "Customer Since", value: (r) => r.customerSince },
  { header: "First Name", value: (r) => r.firstName },
  { header: "Last Name", value: (r) => r.lastName },
  { header: "PSID", value: (r) => r.psid },
  { header: "Capital", value: (r) => r.capital },
  { header: "State", value: (r) => r.state },
  { header: "Age", value: (r) => r.age },
  { header: "Gender", value: (r) => r.gender },
  { header: "Nationality", value: (r) => r.nationality },
];

export function exportCustomersCsv(rows: CustomerExportRow[], filename: string): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    COLUMNS.map((c) => esc(c.header)).join(","),
    ...rows.map((r) => COLUMNS.map((c) => esc(c.value(r))).join(",")),
  ];
  // The BOM makes Excel read the file as UTF-8, so Khmer names and addresses stay readable.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  download(blob, filename);
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Opens the list as a print-ready page and starts the browser's print dialog, where "Save as PDF" makes the file.
// The browser draws the text, so Khmer names and addresses come out right (a PDF built with jsPDF's own fonts can't).
//
// Browsers only allow a pop-up opened straight from a click, so the window is opened first (openPrintWindow, called in
// the click handler) and filled in here once the customers have been loaded.
export function openPrintWindow(): Window {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Allow pop-ups for this site, then try again");
  win.document.write("<p style=\"font-family:system-ui;padding:24px\">Preparing the customer list…</p>");
  return win;
}

export function exportCustomersPdf(win: Window, rows: CustomerExportRow[], title: string, note: string): void {
  // The PDF leaves out the long, rarely needed columns so the table fits a landscape page.
  const shown = COLUMNS.filter((c) => !["Email", "First Name", "Last Name", "PSID", "Capital", "Nationality"].includes(c.header));
  const head = shown.map((c) => `<th>${html(c.header)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${shown.map((c) => `<td${["Orders", "Products", "Spent"].includes(c.header) ? ' class="n"' : ""}>${html(c.value(r))}</td>`).join("")}</tr>`)
    .join("");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${html(title)}</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: system-ui, "Noto Sans Khmer", "Khmer OS", sans-serif; font-size: 10px; color: #111; }
    h1 { font-size: 16px; margin: 0 0 2px; } p { margin: 0 0 10px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; color: #555; border-bottom: 1.5px solid #999; padding: 4px 6px; }
    td { padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
    td.n { text-align: right; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body><h1>${html(title)}</h1><p>${html(note)}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;

  win.document.open();
  win.document.write(doc);
  win.document.close();
  win.focus();
  // Let the page lay out (and load the Khmer font) before the dialog opens.
  setTimeout(() => win.print(), 600);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
