"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden rounded-full bg-brand px-6 py-2 text-sm font-medium text-black"
    >
      Print / Save as PDF
    </button>
  );
}
