"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Search } from "lucide-react";
import TopBarSlot from "@/components/TopBarSlot";
import type { Brand } from "@/types/database";
import { linkLedgerProductsAction } from "../actions";

export type MatchRow = {
  ledgerId: string;
  name: string;
  category: string | null;
  sku: string;
  // The Stock products it looks like, best first; score 0..1.
  // `business` is set when the Stock product is another business's.
  candidates: { id: string; name: string; sku: string | null; business: string | null; score: number }[];
};

// Suggestions at or above this are picked by "Pick the best matches" (the rest need a look).
const GOOD_SCORE = 0.6;
const PAGE = 100;

const inputCls =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-brand focus:ring-2 focus:ring-brand/20";

export default function MatchProductsClient({
  brands,
  currentBrandId,
  rows,
  linkedCount,
}: {
  brands: Brand[];
  currentBrandId: string;
  rows: MatchRow[];
  linkedCount: number;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [onlySuggested, setOnlySuggested] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) => (!onlySuggested || r.candidates.length > 0) && (!q || r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
    );
  }, [rows, search, onlySuggested]);

  const pickedCount = Object.values(picked).filter(Boolean).length;
  const withSuggestions = rows.filter((r) => r.candidates.length > 0).length;

  function pickBest() {
    const next = { ...picked };
    for (const r of rows) {
      if (!next[r.ledgerId] && r.candidates[0] && r.candidates[0].score >= GOOD_SCORE) next[r.ledgerId] = r.candidates[0].id;
    }
    setPicked(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const links = Object.entries(picked)
        .filter(([, stockProductId]) => stockProductId)
        .map(([ledgerProductId, stockProductId]) => ({ ledgerProductId, stockProductId }));
      const { linked } = await linkLedgerProductsAction({ links });
      setNotice(`Linked ${linked} product${linked === 1 ? "" : "s"}.`);
      setPicked({});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the links");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBarSlot>
        <select
          aria-label="Business"
          className="min-w-0 max-w-[10.5rem] rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground sm:max-w-none"
          value={currentBrandId}
          onChange={(e) => router.push(`/stock/ledger/match?brand=${e.target.value}`)}
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <h1 className="hidden items-center gap-2 text-sm sm:flex">
          <Link href={`/stock/ledger?brand=${currentBrandId}`} className="text-muted-foreground hover:underline">
            Daily Ledger
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-foreground">Match products</span>
        </h1>
      </TopBarSlot>

      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 pb-28 sm:px-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Match products</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Some products have a different name in the Daily Ledger than in Stock, or are kept in Stock under another business
            (shown after a dash). Pick the Stock product each one is the same as — a supplier invoice for it then adds to that
            Stock product too. Nothing is renamed or merged, and you can undo a link any time.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{rows.length}</span> not linked ·{" "}
            <span className="font-medium text-foreground">{withSuggestions}</span> with a suggestion ·{" "}
            <span className="font-medium text-foreground">{linkedCount}</span> already linked
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label="Search ledger products"
              placeholder="Search a ledger product or SKU"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShown(PAGE);
              }}
              className={`${inputCls} pl-9`}
            />
          </div>
          <label className="flex h-10 items-center gap-2 rounded-lg px-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={onlySuggested}
              onChange={(e) => {
                setOnlySuggested(e.target.checked);
                setShown(PAGE);
              }}
            />
            Only with a suggestion
          </label>
          <button
            type="button"
            onClick={pickBest}
            className="h-10 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-muted"
          >
            Pick the best matches
          </button>
          {pickedCount > 0 && (
            <button
              type="button"
              onClick={() => setPicked({})}
              className="h-10 rounded-lg px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
        {notice && !error && (
          <p className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600">{notice}</p>
        )}

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <Link2 className="size-5" />
            </span>
            <p className="text-sm font-medium text-foreground">
              {rows.length === 0 ? "Every ledger product is linked" : "Nothing to show"}
            </p>
            <p className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "There are no unlinked products left for this business."
                : "Untick “Only with a suggestion” to see the products with no similar Stock name, or change the search."}
            </p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <li className="hidden grid-cols-[1fr_1fr] gap-4 border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:grid">
              <span>Daily Ledger product</span>
              <span>Same as this Stock product</span>
            </li>
            {visible.slice(0, shown).map((r) => {
              const chosen = picked[r.ledgerId] ?? "";
              const score = r.candidates.find((c) => c.id === chosen)?.score;
              return (
                <li key={r.ledgerId} className="grid gap-2 border-b border-border/60 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_1fr] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[r.category, r.sku && `SKU ${r.sku}`].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Stock product for ${r.name}`}
                      value={chosen}
                      onChange={(e) => setPicked((p) => ({ ...p, [r.ledgerId]: e.target.value }))}
                      disabled={r.candidates.length === 0}
                      className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                    >
                      <option value="">{r.candidates.length === 0 ? "No similar Stock product" : "— Not linked —"}</option>
                      {r.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.sku ? ` (${c.sku})` : ""}
                          {c.business ? ` — ${c.business}` : ""} · {Math.round(c.score * 100)}%
                        </option>
                      ))}
                    </select>
                    {score !== undefined && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          score >= GOOD_SCORE ? "bg-green-500/15 text-green-600" : "bg-amber-500/15 text-amber-600"
                        }`}
                      >
                        {score >= GOOD_SCORE ? "Likely" : "Check"}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {visible.length > shown && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              Show more ({visible.length - shown} left)
            </button>
          </div>
        )}
      </div>

      {pickedCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-2xl backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{pickedCount}</span> product{pickedCount === 1 ? "" : "s"} picked
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-white shadow-sm transition hover:brightness-95 disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              Link {pickedCount} product{pickedCount === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
