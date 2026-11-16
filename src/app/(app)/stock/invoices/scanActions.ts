"use server";

import { requireStockAccess } from "@/lib/stockAccess";
import type { ParsedInvoice } from "@/lib/invoiceOcr";

// Reads a photo of a supplier invoice with Google Gemini (vision) and returns it in the shape the invoice form
// fills from. Needs GEMINI_API_KEY (a free key from Google AI Studio); GEMINI_MODEL optionally picks the model.
// Returns { error } instead of throwing: a thrown message is hidden in production.

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODEL = "gemini-flash-lite-latest";
const MAX_BASE64 = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const PROMPT = `This is a photo of a supplier's invoice. Read it and return JSON.
- supplierName: the company that ISSUED the invoice (the seller / logo at the top). NOT the "To", "Bill to", "Customer" or "Company Name" box -- that is the buyer. Empty string if the seller isn't shown.
- invoiceNumber: the invoice number (often labelled "Invoice No"). Empty string if none.
- invoiceDate: the invoice date as YYYY-MM-DD. Dates are day first (02/Oct/2026 is 2026-10-02). Empty string if none.
- lines: one entry per filled product row in the table, in order. sku = the SKU / item code, name = the description, packing = the packing column (for example "(2L)" or "pkt"), unit = the unit column (for example "Bottle"), quantity = the quantity column (Q. / Qty), unitCost = the UNIT PRICE column as a plain number (no currency symbol).
Copy text exactly as printed; do not guess. Use an empty string for a blank cell and null for a number you cannot read. Skip empty rows and the subtotal / total / tax rows.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    supplierName: { type: "STRING" },
    invoiceNumber: { type: "STRING" },
    invoiceDate: { type: "STRING" },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sku: { type: "STRING" },
          name: { type: "STRING" },
          packing: { type: "STRING" },
          unit: { type: "STRING" },
          quantity: { type: "NUMBER", nullable: true },
          unitCost: { type: "NUMBER", nullable: true },
        },
        required: ["sku", "name", "packing", "unit", "quantity", "unitCost"],
      },
    },
  },
  required: ["supplierName", "invoiceNumber", "invoiceDate", "lines"],
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export async function scanInvoiceImageAction(input: {
  imageBase64: string;
  mimeType: string;
}): Promise<{ invoice: ParsedInvoice } | { error: string }> {
  await requireStockAccess();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "Scanning isn't set up yet: add GEMINI_API_KEY to the environment (a free key from Google AI Studio)." };
  if (!ALLOWED_TYPES.has(input.mimeType) || !input.imageBase64 || input.imageBase64.length > MAX_BASE64) {
    return { error: "Use a JPG, PNG or WebP photo under about 3 MB." };
  }

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: input.mimeType, data: input.imageBase64 } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
  });
  // Google answers 503 ("model overloaded") now and then: try the model twice, then the lighter fallback model.
  let res: Response | null = null;
  try {
    for (const model of [...new Set([MODEL, FALLBACK_MODEL])]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: requestBody,
        });
        if (res.status !== 503 && res.status !== 500) break;
        console.error(`Gemini scan: ${model} returned ${res.status}`);
      }
      if (res && res.status !== 503 && res.status !== 500) break;
    }
  } catch {
    return { error: "Could not reach the scanning service. Check the connection and try again." };
  }
  if (!res) return { error: "Could not reach the scanning service. Try again." };
  if (res.status === 429) return { error: "The free scan limit is used up for now. Try again later, or use Paste lines." };
  if (res.status === 503) return { error: "Google's scanning service is busy right now. Wait a minute and try again, or use Paste lines." };
  if (!res.ok) return { error: `The scanning service returned an error (${res.status}). Try again, or use Paste lines.` };

  let parsed: Record<string, unknown>;
  try {
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    parsed = JSON.parse(body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "");
  } catch {
    return { error: "Could not read that photo. Try a clearer one, or use Paste lines." };
  }

  const date = str(parsed.invoiceDate, 10);
  const rows = Array.isArray(parsed.lines) ? (parsed.lines as Record<string, unknown>[]) : [];
  const lines = rows
    .map((r) => ({
      sku: str(r.sku, 60),
      name: str(r.name),
      unit: str(r.unit, 40),
      packing: str(r.packing, 40),
      quantity: num(r.quantity),
      unitCost: num(r.unitCost),
    }))
    .filter((l) => l.name || l.sku);
  return {
    invoice: {
      supplierName: str(parsed.supplierName, 120),
      invoiceNumber: str(parsed.invoiceNumber, 60),
      invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      lines,
    },
  };
}
