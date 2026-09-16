"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import type { Brand } from "@/types/database";
import type { ProductWithStock } from "@/lib/supabase/queries";
import { computeLineTotal, computeSetTotalCost, computeUnitCostForScale, productWeightGrams } from "@/lib/costControl";
import {
  addSetItemAction,
  createSetAction,
  deleteSetAction,
  duplicateSetAction,
  removeSetItemAction,
  updateSetAction,
  updateSetItemAction,
  type SetDetail,
  type SetItemDetail,
  type SetSummary,
} from "./costControlActions";

function formatMoney(n: number | null): string {
  return n === null ? "—" : `$${n.toFixed(2)}`;
}

const inputClass =
  "rounded border border-black/[.15] bg-transparent px-3 py-1.5 text-sm dark:border-white/[.2]";
const selectClass =
  "rounded border border-black/[.15] bg-card px-3 py-1.5 text-sm text-foreground dark:border-white/[.2]";

// Common Set-item scales -- a line's current value is always included even
// when it's not one of these (e.g. a custom unit typed before this dropdown
// existed), so switching to a select never silently changes existing data.
const SCALE_OPTIONS = ["pcs", "kg", "g", "box", "pack", "set"];

export default function CostControlClient({
  brands,
  currentBrand,
  sets,
  products,
  activeSet,
  isBuilderOpen,
}: {
  brands: Brand[];
  currentBrand: Brand;
  sets: SetSummary[];
  products: ProductWithStock[];
  activeSet: SetDetail | null;
  isBuilderOpen: boolean;
}) {
  const router = useRouter();

  function switchBrand(brandId: string) {
    router.push(`/marketing?tab=cost-control&brand=${brandId}`);
  }

  return (
    <div className="min-h-screen p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-medium">Cost Control</h1>
        <select className={`ml-auto ${selectClass}`} value={currentBrand.id} onChange={(e) => switchBrand(e.target.value)}>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {isBuilderOpen ? (
        <SetBuilder brandId={currentBrand.id} products={products} activeSet={activeSet} />
      ) : (
        <SetsOverview brandId={currentBrand.id} sets={sets} />
      )}
    </div>
  );
}

// ---------- Sets Overview ----------

function SetsOverview({ brandId, sets }: { brandId: string; sets: SetSummary[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SetSummary | null>(null);
  const [duplicating, setDuplicating] = useState<SetSummary | null>(null);

  function openSet(id: string) {
    router.push(`/marketing?tab=cost-control&brand=${brandId}&set=${id}`);
  }

  function newSet() {
    router.push(`/marketing?tab=cost-control&brand=${brandId}&set=new`);
  }

  function doDelete(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteSetAction(id);
        router.refresh();
        setConfirmDelete(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete set");
      }
    });
  }

  return (
    <section className="mt-6 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">Sets</h2>
        <button
          type="button"
          onClick={newSet}
          className="ml-auto flex items-center gap-1.5 rounded bg-brand px-3 py-1.5 text-sm font-medium text-black hover:brightness-95"
        >
          <Plus className="size-3.5" />
          New Set
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/[.08] text-xs text-zinc-500 dark:border-white/[.145]">
              <th className="py-2 pr-3 font-medium">Set ID</th>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 text-right font-medium">Items</th>
              <th className="py-2 pr-3 text-right font-medium">Total Cost</th>
              <th className="py-2 pr-3 text-right font-medium">Suggested Price</th>
              <th className="py-2 pr-3 text-right font-medium">Margin %</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
            {sets.map((s) => (
              <tr key={s.id} className="hover:bg-black/[.02] dark:hover:bg-white/[.03]">
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => openSet(s.id)}
                    className="font-medium text-brand hover:underline"
                  >
                    {s.code}
                  </button>
                </td>
                <td className="py-2 pr-3">{s.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{s.itemCount}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(s.totalCost)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(s.suggestedSellPrice)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {s.marginPct === null ? "—" : `${s.marginPct.toFixed(1)}%`}
                </td>
                <td className="py-2 pr-3 capitalize">{s.status}</td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      title="Edit"
                      onClick={() => openSet(s.id)}
                      className="rounded p-1 text-zinc-500 hover:bg-black/[.06] dark:hover:bg-white/[.1]"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Duplicate"
                      onClick={() => setDuplicating(s)}
                      className="rounded p-1 text-zinc-500 hover:bg-black/[.06] dark:hover:bg-white/[.1]"
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => setConfirmDelete(s)}
                      className="rounded p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sets.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm text-zinc-500">
                  No sets yet for this business.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !isPending && setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-foreground">Delete this set?</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              &quot;{confirmDelete.name}&quot; ({confirmDelete.code}) and its {confirmDelete.itemCount} item
              {confirmDelete.itemCount === 1 ? "" : "s"} will be removed. This can&apos;t be undone.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => doDelete(confirmDelete.id)}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicating && (
        <DuplicateSetDialog set={duplicating} onClose={() => setDuplicating(null)} />
      )}
    </section>
  );
}

function DuplicateSetDialog({ set, onClose }: { set: SetSummary; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(`${set.code}-copy`);
  const [name, setName] = useState(`${set.name} (copy)`);

  function submit() {
    if (!code.trim() || !name.trim()) {
      setError("Enter a Set ID and name");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const { id } = await duplicateSetAction(set.id, code, name);
        onClose();
        router.push(`/marketing?tab=cost-control&set=${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to duplicate set");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !isPending && onClose()}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-foreground">Duplicate &quot;{set.name}&quot;</h2>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">New Set ID</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">New name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={isPending} onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
            Cancel
          </button>
          <button type="button" disabled={isPending} onClick={submit} className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-black hover:brightness-95 disabled:opacity-50">
            {isPending ? "Duplicating…" : "Duplicate"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Set Builder ----------

function SetBuilder({
  brandId,
  products,
  activeSet,
}: {
  brandId: string;
  products: ProductWithStock[];
  activeSet: SetDetail | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // --- Create mode: no set yet -- just a small shell form. ---
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  function createSet() {
    if (!newCode.trim() || !newName.trim()) {
      setError("Enter a Set ID and name");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const { id } = await createSetAction({ brandId, code: newCode, name: newName });
        router.push(`/marketing?tab=cost-control&brand=${brandId}&set=${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create set");
      }
    });
  }

  if (!activeSet) {
    return (
      <section className="mt-6 max-w-lg rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
        <h2 className="font-medium">New Set</h2>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Set ID</span>
            <input
              type="text"
              placeholder="e.g. A1"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Set name</span>
            <input
              type="text"
              placeholder="e.g. Sashimi Gift Box"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={createSet}
            className="rounded bg-brand px-4 py-1.5 text-sm font-medium text-black hover:brightness-95 disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create Set"}
          </button>
          <Link
            href={`/marketing?tab=cost-control&brand=${brandId}`}
            className="rounded border border-black/[.15] px-4 py-1.5 text-sm dark:border-white/[.2]"
          >
            Cancel
          </Link>
        </div>
      </section>
    );
  }

  return <SetEditor brandId={brandId} products={products} set={activeSet} />;
}

function SetEditor({
  brandId,
  products,
  set,
}: {
  brandId: string;
  products: ProductWithStock[];
  set: SetDetail;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Header fields -- each saves independently on blur.
  const [codeDraft, setCodeDraft] = useState(set.code);
  const [nameDraft, setNameDraft] = useState(set.name);

  // Add-product search
  const [query, setQuery] = useState("");
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState("");

  // Per-row edit drafts
  const [itemDrafts, setItemDrafts] = useState<Record<string, { amount?: string; unit?: string; unitCost?: string }>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function saveField(fields: Parameters<typeof updateSetAction>[1]) {
    setError(null);
    startTransition(async () => {
      try {
        await updateSetAction(set.id, fields);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  const inSetIds = new Set(set.items.map((i) => i.productId));
  const matches =
    query.trim().length === 0
      ? []
      : products
          .filter((p) => !inSetIds.has(p.id) && p.name.toLowerCase().includes(query.trim().toLowerCase()))
          .slice(0, 8);
  const pendingProduct = products.find((p) => p.id === pendingProductId) ?? null;

  function pickProduct(p: ProductWithStock) {
    setPendingProductId(p.id);
    setQuery(p.name);
    setAmountDraft("");
  }

  function confirmAdd() {
    if (!pendingProduct) return;
    const amount = parseFloat(amountDraft);
    if (Number.isNaN(amount) || amount <= 0) {
      setError("Enter an amount greater than zero");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addSetItemAction({ setId: set.id, productId: pendingProduct.id, amount });
        setPendingProductId(null);
        setQuery("");
        setAmountDraft("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add product");
      }
    });
  }

  // On blur, just validate/normalize the amount draft -- actual saving is
  // deferred to the Save button below the table so edits across rows commit
  // together. (unit/unitCost are set programmatically by changeScale below,
  // not typed, so they don't need this.)
  function normalizeAmount(itemId: string, raw: string | undefined, current: number) {
    if (raw === undefined) return;
    const clear = () =>
      setItemDrafts((prev) => {
        const row = { ...(prev[itemId] ?? {}) };
        delete row.amount;
        const next = { ...prev };
        if (Object.keys(row).length === 0) delete next[itemId];
        else next[itemId] = row;
        return next;
      });

    const trimmed = raw.trim();
    const value = trimmed === "" ? null : parseFloat(trimmed);
    if (value === null || Number.isNaN(value) || value <= 0) {
      clear();
      return;
    }
    if (value === current) clear();
  }

  // Scale isn't just a label -- switching to kg/g rescales Unit Cost from
  // the product's base per-pack cost (using its known weight), so e.g. a
  // 500g pack at $31.50 shows $63.00 for kg or $0.0630 for g instead of
  // reusing the flat pack price under a misleading unit.
  function changeScale(item: SetItemDetail, newScale: string) {
    const weightGrams = productWeightGrams(item.productUnit, item.productName, item.productWeightGrams);
    const newUnitCost =
      item.baseCostPerUnit === null ? null : computeUnitCostForScale(item.baseCostPerUnit, weightGrams, newScale);

    // Moving between kg/g keeps the same physical amount (5kg -> 500000...
    // no, -> 5000g), converting it rather than leaving the number as-is.
    // Moving from a non-weight scale (pcs/box/...) into kg/g for the first
    // time has no "physical amount" to convert from, so default to the
    // product's whole known weight -- e.g. a 5kg product defaults to "5"
    // under kg, not "1" (its pcs count) relabeled.
    const draft = itemDrafts[item.id] ?? {};
    const currentScale = (draft.unit ?? item.unit).trim().toLowerCase();
    const newScaleLower = newScale.trim().toLowerCase();
    const isNewWeightScale = newScaleLower === "kg" || newScaleLower === "g";
    let newAmount: number | null = null;
    if (weightGrams !== null && isNewWeightScale) {
      const isCurrentWeightScale = currentScale === "kg" || currentScale === "g";
      const currentAmount = parseFloat(draft.amount ?? String(item.amount));
      if (isCurrentWeightScale && !Number.isNaN(currentAmount) && currentAmount > 0) {
        const grams = currentScale === "kg" ? currentAmount * 1000 : currentAmount;
        newAmount = newScaleLower === "kg" ? grams / 1000 : grams;
      } else {
        newAmount = newScaleLower === "kg" ? weightGrams / 1000 : weightGrams;
      }
    }

    setItemDrafts((prev) => {
      if (newScale === item.unit && newUnitCost === item.unitCost && newAmount === null) {
        const row = { ...(prev[item.id] ?? {}) };
        delete row.unit;
        delete row.unitCost;
        const next = { ...prev };
        if (Object.keys(row).length === 0) delete next[item.id];
        else next[item.id] = row;
        return next;
      }
      return {
        ...prev,
        [item.id]: {
          ...prev[item.id],
          unit: newScale,
          unitCost: newUnitCost === null ? "" : String(newUnitCost),
          ...(newAmount !== null ? { amount: String(newAmount) } : {}),
        },
      };
    });
  }

  const itemsDirty = Object.keys(itemDrafts).length > 0;

  // Total Cost also recomputes live from the boxes, not just from what's
  // saved -- same reasoning as liveLineTotal per row above.
  const liveTotalCost = computeSetTotalCost(
    set.items.map((item) => {
      const draft = itemDrafts[item.id] ?? {};
      const amount = draft.amount !== undefined ? parseFloat(draft.amount) : item.amount;
      const unitCostRaw = draft.unitCost ?? (item.unitCost === null ? "" : String(item.unitCost));
      const unitCost = unitCostRaw.trim() === "" ? null : parseFloat(unitCostRaw);
      return {
        amount: Number.isNaN(amount) ? item.amount : amount,
        unitCost: unitCost !== null && Number.isNaN(unitCost) ? item.unitCost : unitCost,
      };
    })
  );
  const liveItemsMissingCost = set.items.filter((item) => {
    const draft = itemDrafts[item.id];
    const unitCostRaw = draft?.unitCost ?? (item.unitCost === null ? "" : String(item.unitCost));
    return unitCostRaw.trim() === "";
  }).length;

  function saveItems() {
    setError(null);
    const entries = Object.entries(itemDrafts);
    startTransition(async () => {
      try {
        await Promise.all(
          entries.map(([itemId, draft]) => {
            const fields: Parameters<typeof updateSetItemAction>[1] = {};
            if (draft.amount !== undefined) fields.amount = parseFloat(draft.amount);
            if (draft.unit !== undefined) fields.unit = draft.unit.trim();
            if (draft.unitCost !== undefined)
              fields.unitCost = draft.unitCost.trim() === "" ? null : parseFloat(draft.unitCost);
            return updateSetItemAction(itemId, fields);
          })
        );
        setItemDrafts({});
        router.push(`/marketing?tab=cost-control&brand=${brandId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  function removeItem(itemId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeSetItemAction(itemId);
        router.refresh();
        setConfirmRemove(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove item");
      }
    });
  }

  return (
    <section className="mt-6 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/marketing?tab=cost-control&brand=${brandId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to Sets
        </Link>
      </div>

      <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Set ID</span>
            <input
              type="text"
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              onBlur={() => codeDraft.trim() !== set.code && saveField({ code: codeDraft })}
              className={inputClass}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Set name</span>
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => nameDraft.trim() !== set.name && saveField({ name: nameDraft })}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Status</span>
            <select
              value={set.status}
              onChange={(e) => saveField({ status: e.target.value as "draft" | "active" })}
              className={selectClass}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
        <h2 className="font-medium">Items</h2>

        <div className="relative mt-3 max-w-md">
          <input
            type="text"
            placeholder="Search products to add…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPendingProductId(null);
            }}
            className={`w-full ${inputClass}`}
          />
          {matches.length > 0 && !pendingProduct && (
            <div className="absolute z-10 mt-1 w-full rounded border border-black/[.15] bg-card shadow-lg dark:border-white/[.2]">
              {matches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProduct(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-black/[.05] dark:hover:bg-white/[.08]"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-zinc-500">
                    {p.unit} · {p.cost_price === null ? "no cost" : `$${p.cost_price.toFixed(2)}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {pendingProduct && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-black/[.15] px-3 py-2 dark:border-white/[.2]">
            <span className="font-medium">{pendingProduct.name}</span>
            <span className="text-xs text-zinc-500">
              Unit: {pendingProduct.unit} · Cost:{" "}
              {pendingProduct.cost_price === null ? "unknown" : formatMoney(pendingProduct.cost_price)}
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Amount"
              value={amountDraft}
              autoFocus
              onChange={(e) => setAmountDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmAdd();
                if (e.key === "Escape") {
                  setPendingProductId(null);
                  setQuery("");
                }
              }}
              className={`w-24 ${inputClass}`}
            />
            <button
              type="button"
              disabled={isPending}
              onClick={confirmAdd}
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-black hover:brightness-95 disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingProductId(null);
                setQuery("");
              }}
              className="text-xs text-zinc-500"
            >
              Cancel
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/[.08] text-xs text-zinc-500 dark:border-white/[.145]">
                <th className="py-2 pr-3 font-medium">Product</th>
                <th className="py-2 pr-3 text-right font-medium">Amount</th>
                <th className="py-2 pr-3 font-medium">Scale</th>
                <th className="py-2 pr-3 text-right font-medium">Unit Cost</th>
                <th className="py-2 pr-3 text-right font-medium">Line Total</th>
                <th className="w-16 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
              {set.items.map((item) => {
                const draft = itemDrafts[item.id] ?? {};
                const amountValue = draft.amount ?? String(item.amount);
                const unitValue = draft.unit ?? item.unit;
                const unitCostValue = draft.unitCost ?? (item.unitCost === null ? "" : String(item.unitCost));
                const weightGramsForRow = productWeightGrams(item.productUnit, item.productName, item.productWeightGrams);
                const confirming = confirmRemove === item.id;
                // Recompute live from whatever's currently in the boxes --
                // don't wait for Save to see the effect of an edit.
                const liveAmount = parseFloat(amountValue);
                const liveUnitCost = unitCostValue.trim() === "" ? null : parseFloat(unitCostValue);
                const liveLineTotal =
                  !Number.isNaN(liveAmount) && (liveUnitCost === null || !Number.isNaN(liveUnitCost))
                    ? computeLineTotal({ amount: liveAmount, unitCost: liveUnitCost })
                    : item.lineTotal;
                return (
                  <tr key={item.id}>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                          {item.productImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.productImageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-400">
                              No img
                            </div>
                          )}
                        </div>
                        <span>{item.productName}</span>
                      </div>
                    </td>
                    {confirming ? (
                      <td colSpan={5} className="py-2">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-zinc-500">Remove &quot;{item.productName}&quot;?</span>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="text-xs font-medium text-red-500"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(null)}
                            className="text-xs text-zinc-500"
                          >
                            No
                          </button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="py-2 pr-3 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={amountValue}
                            onChange={(e) =>
                              setItemDrafts((prev) => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], amount: e.target.value },
                              }))
                            }
                            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                            onBlur={() => normalizeAmount(item.id, itemDrafts[item.id]?.amount, item.amount)}
                            className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm dark:border-white/[.2]"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={unitValue}
                            onChange={(e) => changeScale(item, e.target.value)}
                            className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                          >
                            {(SCALE_OPTIONS.includes(unitValue) ? SCALE_OPTIONS : [unitValue, ...SCALE_OPTIONS]).map(
                              (opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              )
                            )}
                          </select>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums" title="Auto-calculated from Stock">
                          {weightGramsForRow !== null && item.baseCostPerUnit !== null ? (
                            <span className="text-zinc-500">
                              {formatMoney(item.baseCostPerUnit)} / {weightGramsForRow}g
                            </span>
                          ) : (
                            formatMoney(liveUnitCost)
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(liveLineTotal)}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            title="Remove"
                            onClick={() => setConfirmRemove(item.id)}
                            className="rounded p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {set.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-zinc-500">
                    No products in this set yet -- search above to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={saveItems}
              className="rounded bg-brand px-4 py-1.5 text-sm font-medium text-black hover:brightness-95 disabled:cursor-not-allowed"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            {itemsDirty && !isPending && <span className="text-xs text-zinc-500">Unsaved changes</span>}
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-500">Total Cost</div>
            <div className="text-xl font-semibold">{formatMoney(liveTotalCost)}</div>
            {liveItemsMissingCost > 0 && (
              <div className="text-xs text-amber-600 dark:text-amber-500">
                {liveItemsMissingCost} item{liveItemsMissingCost === 1 ? "" : "s"} missing cost
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
