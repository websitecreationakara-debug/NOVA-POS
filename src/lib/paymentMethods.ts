// Single source of truth for payment_method values -- imported by checkout
// (SalesClient), order editing (OrderEditor), invoice printing (InvoiceDoc),
// online order sync (order-sync route), and Accountance reporting, instead
// of each keeping its own hardcoded cash/bank_qr list or label map.
export type PaymentMethod = "cash" | "aba_pay" | "wing" | "khqr" | "card" | "bank_qr";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  aba_pay: "ABA Pay",
  wing: "Wing",
  khqr: "KHQR",
  card: "Visa/Mastercard",
  // bank_qr predates these specific methods -- kept only so historical
  // orders (and editing them) still show/save correctly, not offered as a
  // new checkout choice.
  bank_qr: "Bank/QR (legacy)",
};

// Selectable at the POS checkout going forward.
export const CHECKOUT_PAYMENT_METHODS: PaymentMethod[] = ["khqr", "cash"];

export const ALL_PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];
