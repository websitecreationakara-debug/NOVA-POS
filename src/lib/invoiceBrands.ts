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
  "អរគុណសម្រាប់ការកម្មង់អាហារ សូមជូនពរមានសុខភាពល្អ និងសំណាងល្អ",
  "យើងព្យាយាមឲ្យអស់ពីលទ្ធភាព ដើម្បីផ្តល់ជូនផលិតផល សេវាកម្មដែលល្អបំផុតជូនលោកអ្នក",
];

const FALLBACK: InvoiceBrandConfig = {
  contactLine: "ផ្លូវ388 ទួលស្វាយព្រៃ ភ្នំពេញ: 099 361 350",
  khqrUrl: null,
  khqrLabel: "NOVA",
  remarks: DEFAULT_REMARKS,
  closing: DEFAULT_CLOSING,
};

// All three currently share the NOVA merchant KHQR (public/khqr/nova.png).
// Set khqrUrl to null to hide the QR block for a brand.
export const INVOICE_BRANDS: Record<string, InvoiceBrandConfig> = {
  "bosba-premium-foods": {
    contactLine: "ផ្លូវ388 ទួលស្វាយព្រៃ ភ្នំពេញ: 099 361 350",
    khqrUrl: "/khqr/nova.png",
    khqrLabel: "NOVA",
    remarks: DEFAULT_REMARKS,
    closing: DEFAULT_CLOSING,
  },
  "bosba-drink-snack": {
    // TODO: confirm the shop address/phone for BOSBA Drink & Snack.
    contactLine: "ផ្លូវ388 ទួលស្វាយព្រៃ ភ្នំពេញ: 099 361 350",
    khqrUrl: "/khqr/nova.png",
    khqrLabel: "NOVA",
    remarks: DEFAULT_REMARKS,
    closing: DEFAULT_CLOSING,
  },
  "sora-sake": {
    // TODO: confirm the shop address/phone for SORA SAKE.
    contactLine: "ផ្លូវ388 ទួលស្វាយព្រៃ ភ្នំពេញ: 099 361 350",
    khqrUrl: "/khqr/nova.png",
    khqrLabel: "NOVA",
    remarks: DEFAULT_REMARKS,
    closing: DEFAULT_CLOSING,
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

// Fixed render height (Tailwind class) for the letterhead logo. Most source
// files are cropped tight to their artwork so one height reads consistently,
// but bosba-drink-snack.webp and sora-sake.png both sit well inside their
// frame (a wide canvas with padding around the badge+text/bottle), so the
// default height renders them visibly smaller than bosba-premium-foods'
// tightly-cropped logo -- bumped up here to match its on-page weight.
const BRAND_LOGO_HEIGHT: Record<string, string> = {
  "bosba-drink-snack": "h-24",
  "sora-sake": "h-24",
};
const DEFAULT_LOGO_HEIGHT = "h-16";

export function brandLogoHeightClass(slug: string | null): string {
  return (slug && BRAND_LOGO_HEIGHT[slug]) || DEFAULT_LOGO_HEIGHT;
}
