"use client";

// The Accountance page's numbers are already plain text/numbers (no chart or
// invoice layout to preserve), so this builds the PDF directly from jsPDF's
// text primitives instead of screenshotting the page like exportInvoicePdf
// does -- smaller output, crisp text at any zoom, and no dependency on the
// page's on-screen theme/colors.
export async function exportAccountancePdf(
  filename: string,
  data: {
    businessName: string;
    rangeLabel: string;
    paymentBreakdown: { label: string; total: number }[];
    orderCount: number;
    total: number;
    expenses: { description: string; category: string | null; amount: number }[];
    expenseTotal: number;
  }
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const money = (n: number) => `$${n.toFixed(2)}`;

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 18;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  let y = 20;

  function ensureRoom(nextLineHeight: number) {
    if (y + nextLineHeight > pageH - 16) {
      pdf.addPage();
      y = 20;
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("Accounting Report", marginX, y);
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(data.businessName, marginX, y);
  y += 6;
  pdf.setTextColor(110);
  pdf.text(data.rangeLabel, marginX, y);
  pdf.setTextColor(0);
  y += 10;

  function sectionTitle(title: string) {
    ensureRoom(10);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(title, marginX, y);
    y += 2;
    pdf.setDrawColor(210);
    pdf.line(marginX, y, pageW - marginX, y);
    y += 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10.5);
  }

  function row(label: string, value: string, bold = false) {
    ensureRoom(7);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.text(label, marginX, y);
    pdf.text(value, pageW - marginX, y, { align: "right" });
    y += 7;
  }

  sectionTitle("Summary");
  for (const b of data.paymentBreakdown) {
    row(`${b.label} sales`, money(b.total));
  }
  row("Orders", String(data.orderCount));
  row("Total revenue", money(data.total), true);
  y += 4;

  sectionTitle("Expenses");
  if (data.expenses.length === 0) {
    pdf.setTextColor(110);
    pdf.text("No expenses logged for this period.", marginX, y);
    pdf.setTextColor(0);
    y += 7;
  } else {
    for (const e of data.expenses) {
      ensureRoom(7);
      const label = e.category ? `${e.description} (${e.category})` : e.description;
      pdf.text(label, marginX, y, { maxWidth: pageW - marginX * 2 - 30 });
      pdf.text(money(e.amount), pageW - marginX, y, { align: "right" });
      y += 7;
    }
  }
  y += 1;
  row("Total expenses", money(data.expenseTotal), true);
  y += 4;

  sectionTitle("Net");
  row("Net (sales - expenses)", money(data.total - data.expenseTotal), true);

  const safeName = filename.replace(/[\\/:*?"<>|]/g, "-");
  pdf.save(`${safeName}.pdf`);
}
