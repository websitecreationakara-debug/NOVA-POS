// Display formats with thousands separators (1,234,567) -- one place so every
// screen writes a number the same way. Fixed to en-US so the server and the
// browser render identical text.
export const formatCount = (n: number): string => n.toLocaleString("en-US");

export const formatUsd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
