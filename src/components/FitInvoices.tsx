"use client";

import { useEffect, useRef, useState } from "react";

// Shrinks the invoice sheets to fit a narrow screen (a phone), so the whole page
// shows at once instead of a cut-off slice. The sheets keep their real A4 width
// underneath -- only a CSS scale is applied (via --fit), so nothing inside is
// re-laid-out or squeezed. Print ignores the scale, and Save as PDF / PNG put
// the sheets back to full size while they capture (withInvoicesAtFullSize in
// lib/invoiceCapture.ts finds this wrapper by data-fit-wrapper).
export default function FitInvoices({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const update = () => {
      // offsetWidth/offsetHeight are the unscaled layout size, so measuring never
      // feeds back on the scale itself.
      const scale = Math.min(1, wrap.clientWidth / inner.offsetWidth);
      setFit({ scale, height: inner.offsetHeight * scale });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      data-fit-wrapper
      style={fit ? ({ "--fit": fit.scale, "--fit-h": `${fit.height}px` } as React.CSSProperties) : undefined}
      className="w-full overflow-hidden [height:var(--fit-h)] print:h-auto print:overflow-visible"
    >
      <div
        ref={innerRef}
        className="w-[210mm] origin-top-left [transform:scale(var(--fit))] print:w-full print:[transform:none]"
      >
        {children}
      </div>
    </div>
  );
}
