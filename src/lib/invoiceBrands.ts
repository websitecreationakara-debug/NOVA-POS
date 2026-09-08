// Per-brand bits of the printed invoice that don't live in the database:
// the letterhead contact line, the KHQR merchant image, the remarks and the
// closing lines. Keyed by the `brands.slug` value (same slugs the storefront
// catalogs use). Edit the text/images here -- everything else on the invoice
// comes from the order itself.

export type InvoiceBrandConfig = {
  // Shown top-right of the letterhead (address + phone). Keep it one line.
  contactLine: string;
  // Public path to the brand's KHQR merchant QR (drop the file in /public).
  // null hides the whole QR block.
  khqrUrl: string | null;
  // Small caption under the QR, e.g. the Bakong account name.
  khqrLabel: string;
  // "Remarks" bullet lines, printed as-is.
  remarks: string[];
  // Closing lines under the QR.
  closing: string[];
};

const DEFAULT_REMARKS = [
  "Please pay before or during the drop off សូមបង់ប្រាក់មុន ឬនៅពេលទទួលទំនិញ",
  "We accept wire transfer only យើងទទួលប្រាក់តាម KHQR តែមួយគត់",
];

const DEFAULT_CLOSING = [
  "អរគុណសម្រាប់ការកម្ម៉ង់ម្ហូបអាហារ សូមជូនពរមានសុខភាពបរិបូណ៍ និងសំណាងល្អ",
  "យើងខ្ញុំសន្យាថានឹងផ្ដល់ជូនអតិថិជននូវផលិតផលដ៏ល្អ និងសេវាកម្មដ៏ឆាប់រហ័ស",
];

const FALLBACK: InvoiceBrandConfig = {
  contactLine: "",
  khqrUrl: null,
  khqrLabel: "NOVA",
  remarks: DEFAULT_REMARKS,
  closing: DEFAULT_CLOSING,
};

// NOTE: khqrUrl is null until the brand's KHQR merchant QR image is added to
// /public/khqr/<slug>.png (or any public path) and set here -- the invoice
// simply skips the QR block while it's null.
export const INVOICE_BRANDS: Record<string, InvoiceBrandConfig> = {
  "bosba-premium-foods": {
    contactLine: "ផ្លូវ388 ទួលស្វាយព្រៃ ភ្នំពេញ: 099 361 350",
    khqrUrl: null, // e.g. "/khqr/bosba-premium-foods.png"
    khqrLabel: "NOVA",
    remarks: DEFAULT_REMARKS,
    closing: DEFAULT_CLOSING,
  },
  "bosba-drink-snack": {
    // TODO: confirm the shop address/phone for BOSBA Drink & Snack.
    contactLine: "ផ្លូវ388 ទួលស្វាយព្រៃ ភ្នំពេញ: 099 361 350",
    khqrUrl: null, // e.g. "/khqr/bosba-drink-snack.png"
    khqrLabel: "NOVA",
    remarks: DEFAULT_REMARKS,
    closing: DEFAULT_CLOSING,
  },
  "sora-sake": {
    // TODO: confirm the shop address/phone for SORA SAKE.
    contactLine: "",
    khqrUrl: null, // e.g. "/khqr/sora-sake.png"
    khqrLabel: "SORA SAKE",
    remarks: DEFAULT_REMARKS,
    closing: [
      "សូមអរគុណសម្រាប់ការគាំទ្រ Thank you for your purchase",
      "សូមជូនពរឲ្យលោកអ្នកទទួលបានសុភមង្គល និងសំណាងល្អ",
    ],
  },
};

export function invoiceBrandConfig(slug: string | null): InvoiceBrandConfig {
  return (slug && INVOICE_BRANDS[slug]) || FALLBACK;
}

// The brand logo files live in /public/logos (see that folder). Not all are
// PNGs, so map slug -> filename explicitly. Returns null for an unknown brand
// so the invoice can print the plain brand name instead.
const BRAND_LOGO_FILE: Record<string, string> = {
  "bosba-premium-foods": "bosba-premium-foods.png",
  "bosba-drink-snack": "bosba-drink-snack.webp",
  "sora-sake": "sora-sake.png",
};

export function brandLogoPath(slug: string | null): string | null {
  const file = slug ? BRAND_LOGO_FILE[slug] : undefined;
  return file ? `/logos/${file}` : null;
}
