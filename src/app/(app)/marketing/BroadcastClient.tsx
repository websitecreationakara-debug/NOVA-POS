"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Copy } from "lucide-react";
import { formatBroadcast, formatOptions, type BroadcastSection } from "@/lib/broadcast";
import BroadcastPlan from "./BroadcastPlan";

// Marketing > Broadcast: tick what to announce, copy the message. Everything in stock and priced is listed in
// the business's tree (e.g. Beverage > Premium Alcohol); everything starts ticked.
export default function BroadcastClient({
  businessName,
  businesses,
  activeSlug,
  sections,
  today,
}: {
  businessName: string;
  businesses: { slug: string; name: string }[];
  activeSlug: string;
  sections: BroadcastSection[];
  today: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "plan">("list");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(sections.flatMap((s) => s.items.map((i) => i.key)))
  );
  // Hand-edited text; dropped again as soon as the ticks change, so the two never disagree.
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generated = useMemo(() => formatBroadcast(businessName, sections, selected), [businessName, sections, selected]);
  const text = edited ?? generated;

  function toggle(keys: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
    setEdited(null);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text is still selectable in the box.
    }
  }

  return (
    <main className="min-h-screen space-y-6 p-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <span>Marketing</span>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-foreground">Broadcast</span>
      </nav>
      <div>
        <h1 className="text-lg font-medium">Broadcast</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {businessName} · in stock and priced, most-ordered first (last 90 days)
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {businesses.map((b) => (
          <button
            key={b.slug}
            type="button"
            onClick={() => b.slug !== activeSlug && router.push(`/marketing?tab=broadcast&biz=${b.slug}`)}
            aria-pressed={b.slug === activeSlug}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              b.slug === activeSlug
                ? "border-brand bg-brand text-white"
                : "border-border text-foreground hover:bg-black/[.04] dark:hover:bg-white/[.06]"
            }`}
          >
            {b.name}
          </button>
        ))}
      </div>

      <div className="inline-flex gap-1 rounded-xl border border-border bg-muted/50 p-1">
        {(["list", "plan"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              view === v ? "bg-brand text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "list" ? "Product list" : "Month plan"}
          </button>
        ))}
      </div>

      {view === "plan" ? (
        <BroadcastPlan businessName={businessName} sections={sections} today={today} />
      ) : sections.every((s) => s.items.length === 0) ? (
        <p className="text-sm text-muted-foreground">Nothing in stock to broadcast.</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="space-y-4 rounded-xl border border-border bg-card p-4">
            {sections.map((s, idx) => {
              const keys = s.items.map((i) => i.key);
              const all = keys.length > 0 && keys.every((k) => selected.has(k));
              const path = s.path.filter(Boolean).join(" › ");
              const showPath = path !== s.group && (idx === 0 || path !== sections[idx - 1].path.filter(Boolean).join(" › "));
              return (
                <section key={s.group}>
                  {showPath && <p className="mb-1 text-sm font-medium text-muted-foreground">{path}</p>}
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={all}
                      disabled={keys.length === 0}
                      onChange={(e) => toggle(keys, e.target.checked)}
                    />
                    {s.group}
                    {s.items.length === 0 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                        out of stock
                      </span>
                    )}
                  </label>
                  <ul className="mt-1 space-y-1 pl-6">
                    {s.items.map((i) => (
                      <li key={i.key}>
                        <label className="flex items-baseline gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.has(i.key)}
                            onChange={(e) => toggle([i.key], e.target.checked)}
                          />
                          <span className="min-w-0 flex-1">
                            {i.name}
                            <span className="text-muted-foreground"> — {formatOptions(i.options)}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {i.orders > 0 ? `${i.orders} orders · ` : ""}
                            {i.limited ? "limited" : `${i.stock} in stock`}
                          </span>
                        </label>
                      </li>
                    ))}
                    {s.held.length > 0 && (
                      <li className="text-xs text-muted-foreground">Not available: {s.held.join(", ")}</li>
                    )}
                  </ul>
                </section>
              );
            })}
          </div>

          <div className="space-y-3 lg:sticky lg:top-6">
            <textarea
              value={text}
              onChange={(e) => setEdited(e.target.value)}
              rows={20}
              aria-label="Broadcast message"
              className="w-full rounded-xl border border-border bg-card p-3 font-mono text-sm text-foreground"
            />
            <button
              type="button"
              onClick={copy}
              disabled={!text}
              className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy message"}
            </button>
            {edited !== null && (
              <p className="text-xs text-muted-foreground">Edited by hand — changing a tick starts the text over.</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
