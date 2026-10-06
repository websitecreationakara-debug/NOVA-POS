"use client";

export type InsightView = "overview" | "quantity" | "price";

const TABS: { view: InsightView; label: string }[] = [
  { view: "overview", label: "Overview" },
  { view: "quantity", label: "Insight by Quantity" },
  { view: "price", label: "Insight by Price" },
];

export const INSIGHT_VIEW_TITLES: Record<InsightView, string> = {
  overview: "Overview",
  quantity: "Insight by Quantity",
  price: "Insight by Price",
};

// The switch between the three Product Insight views. What a click does is up to
// the page (the overview and the tables are separate loads).
export default function InsightTabs({
  active,
  onChange,
}: {
  active: InsightView;
  onChange: (view: InsightView) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1">
      {TABS.map((t) => (
        <button
          key={t.view}
          type="button"
          onClick={() => onChange(t.view)}
          aria-pressed={active === t.view}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
            active === t.view
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
