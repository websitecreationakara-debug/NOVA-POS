// Deterministic colour for a category name, so a category (Wagyu, Salmon,
// Oyster…) shows the same dot everywhere and cashiers can scan by colour.
export function categoryHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

export function categoryDotColor(name: string): string {
  return `hsl(${categoryHue(name)} 60% 55%)`;
}
