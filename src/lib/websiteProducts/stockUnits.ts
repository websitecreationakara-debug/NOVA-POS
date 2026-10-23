// BOSBA Drink & Snack counts one shared stock in cans, so a "24can" pack takes 24 off it and a
// "6can" pack takes 6. The number in front of "can" in the pack's weight is that many stock
// units per sold pack: "24can", "24 cans (350ml/can)" -> 24. Anything else uses 1.
export function canPackSize(weight: string | null | undefined): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*cans?\b/i.exec(weight ?? "");
  const n = m ? Number(m[1]) : 1;
  return n > 0 ? n : 1;
}

// The same, read from a POS product's name, which is "<title> (<weight>)" for a variation:
// "test (24can)" -> 24.
export function canPackSizeFromName(name: string | null | undefined): number {
  const m = /\(\s*(\d+(?:\.\d+)?\s*cans?\b.*)$/i.exec(name ?? "");
  return canPackSize(m ? m[1] : null);
}
