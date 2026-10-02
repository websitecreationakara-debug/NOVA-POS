"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Trash2, TriangleAlert } from "lucide-react";
import type { WebsiteAddon, WebsiteAddonWrite, WebsiteCatalogId } from "@/lib/websiteProducts/types";
import {
  createWebsiteAddonAction,
  deleteWebsiteAddonAction,
  setAddonDetailsAction,
  setWebsitePurchaseCostAction,
  updateWebsiteAddonAction,
  uploadWebsiteImageAction,
} from "@/app/(app)/stock/websiteActions";
import {
  derivePurchaseCost,
  EMPTY_PURCHASE_COSTS,
  purchaseCostKey,
  type PurchaseCostFields,
} from "@/lib/websiteProducts/purchaseCosts";
import DeleteWebsiteAddonDialog from "@/components/DeleteWebsiteAddonDialog";
import { ENGLISH_SCALES, KHMER_SCALES } from "@/lib/khmerScales";

const fieldInputClass =
  "rounded border border-black/[.15] bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-black/40 dark:border-white/[.2] dark:focus:border-white/50";

const emptyForm: WebsiteAddonWrite = {
  title: "",
  description: "",
  status: "draft",
  image_url: "",
};

// Rows-per-page choices for the table footer -- same options as the product
// table's.
const PAGE_SIZE_OPTIONS = [10, 25, 50];

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

type CostField = "original" | "total10" | "extra" | "total";
const COST_DB_FIELD: Record<
  CostField,
  "original_cost" | "total_cost_10pct" | "extra_money" | "total_override"
> = {
  original: "original_cost",
  total10: "total_cost_10pct",
  extra: "extra_money",
  total: "total_override",
};

const costInputClass =
  "inline-flex w-16 items-center gap-1 rounded border border-black/[.15] px-2 py-1 text-sm tabular-nums focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50";
const costCellClass = "bg-black/[.015] px-2 py-2 text-right dark:bg-white/[.02]";

// Inline replacement for the product table when the "Addons" chip is active
// -- same page, same table area, no popup. Price/stock edits and deletes go
// straight to the storefront's own add-on table (PATCH/DELETE
// /api/v1/addons/:id) -- a separate write path from regular products, so an
// addon id never flows through the product edit/delete endpoints above. Kept
// as its own component (not merged into the product `products`/`toEntries`
// pipeline) for exactly that reason.
export default function WebsiteAddonsTable({
  catalogId,
  addons,
  purchaseCosts,
  fallbackCosts,
  linkedDetails,
  onPreviewImage,
}: {
  catalogId: WebsiteCatalogId;
  addons: WebsiteAddon[];
  // Opens the panel's full-size image pop-up (same one the product table uses).
  onPreviewImage?: (image: { url: string; title: string }) => void;
  // Purchase-cost records for the whole storefront, keyed by purchaseCostKey
  // (an addon is stored under its own id with an empty variation id, the same
  // key its linked POS product uses).
  purchaseCosts?: Record<string, PurchaseCostFields>;
  // addon id -> its linked POS product's cost_price, shown as the Total's
  // placeholder when no Total is entered (same as the product table).
  fallbackCosts?: Record<string, number>;
  // addon id -> the Khmer name / scale saved on its linked POS product, for the
  // Edit box (an addon nobody has linked yet has none).
  linkedDetails?: Record<string, { nameKm: string; unit: string; unitKm: string }>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDeleteAddon, setConfirmDeleteAddon] = useState<WebsiteAddon | null>(null);
  // Bulk selection -- same checkbox + toolbar pattern as the product table
  // above (select-all-on-page, Publish/Draft/Delete selected).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Always-editable Price/Stock cells (blur-to-save), same pattern as the
  // product table above -- no separate click-to-edit step.
  const [drafts, setDrafts] = useState<Record<string, { price?: string; stock?: string }>>({});
  // "Add Stock": a quantity being *received*, added to the current stock on
  // blur then cleared back to empty -- see the product table's addStockDrafts.
  const [addStockDrafts, setAddStockDrafts] = useState<Record<string, string>>({});
  // Draft text for the Original Cost / Total Cost 10% / Extra Cost / Total
  // boxes, keyed by addon id -- each saves on blur, same as the product table.
  const [costDrafts, setCostDrafts] = useState<Record<string, Partial<Record<CostField, string>>>>({});
  // The pencil's Edit box (one addon at a time): name, Khmer name, scale, Khmer
  // scale and picture. editImage is the newly uploaded picture's URL, null while
  // unchanged, "" once Remove image is picked.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", nameKm: "", unit: "pcs", unitKm: "" });
  const [editImage, setEditImage] = useState<string | null>(null);
  const [editImageUploading, setEditImageUploading] = useState(false);
  const [editImageError, setEditImageError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WebsiteAddonWrite>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // A-Z by title, same as the product table above -- the storefront API
  // otherwise returns these in their own arbitrary order.
  const sortedAddons = [...addons].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
  const pageCount = Math.max(1, Math.ceil(sortedAddons.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = sortedAddons.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const pageAddonIds = useMemo(() => paged.map((a) => a.id), [paged]);
  const allOnPageSelected = pageAddonIds.length > 0 && pageAddonIds.every((id) => selected.has(id));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageAddonIds.forEach((id) => next.delete(id));
      else pageAddonIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function bulkSetStatus(status: WebsiteAddonWrite["status"]) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    for (const id of ids) {
      try {
        await updateWebsiteAddonAction(catalogId, id, { status });
      } catch {
        /* keep going; the row will just stay as it was */
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    router.refresh();
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    for (const id of ids) {
      try {
        await deleteWebsiteAddonAction(catalogId, id);
      } catch {
        /* keep going */
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    setConfirmBulkDelete(false);
    router.refresh();
  }

  function handleImagePick(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("File must be an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError("Image must be under 5MB");
      return;
    }
    setImageError(null);
    setUploadingImage(true);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      try {
        const { url } = await uploadWebsiteImageAction(fd);
        setForm((f) => ({ ...f, image_url: url }));
      } catch (e) {
        setImageError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploadingImage(false);
      }
    });
  }

  function submitCreate() {
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    setFormError(null);
    setImageError(null);
    startTransition(async () => {
      try {
        await createWebsiteAddonAction(catalogId, {
          ...form,
          title: form.title.trim(),
          price: Number(form.price ?? 0) || 0,
          stock: form.stock === undefined || form.stock === null ? null : Number(form.stock),
        });
        setForm(emptyForm);
        setShowForm(false);
        router.refresh();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Failed to create addon");
      }
    });
  }

  function setDraft(id: string, field: "price" | "stock", value: string) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function clearDraft(id: string, field: "price" | "stock") {
    setDrafts((prev) => {
      const rowDraft = { ...(prev[id] ?? {}) };
      delete rowDraft[field];
      const next = { ...prev };
      if (Object.keys(rowDraft).length === 0) delete next[id];
      else next[id] = rowDraft;
      return next;
    });
  }

  function saveField(a: WebsiteAddon, input: { price?: number; stock?: number | null }) {
    setError(null);
    setPendingId(a.id);
    startTransition(async () => {
      try {
        await updateWebsiteAddonAction(catalogId, a.id, input);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      } finally {
        setPendingId(null);
      }
    });
  }

  function savePrice(a: WebsiteAddon, raw: string) {
    clearDraft(a.id, "price");
    const price = parseFloat(raw);
    if (Number.isNaN(price) || price < 0) {
      setError("Price must be a non-negative number");
      return;
    }
    if (price === a.price) return;
    saveField(a, { price });
  }

  function saveStock(a: WebsiteAddon, raw: string) {
    clearDraft(a.id, "stock");
    const trimmed = raw.trim();
    const stock = trimmed === "" ? null : parseFloat(trimmed);
    if (stock !== null && (Number.isNaN(stock) || stock < 0)) {
      setError("Stock must be a non-negative number, or blank for unlimited stock");
      return;
    }
    if (stock === a.stock) return;
    saveField(a, { stock });
  }

  function saveCostField(a: WebsiteAddon, field: CostField, currentValue: number | null) {
    const raw = costDrafts[a.id]?.[field];
    if (raw === undefined) return;
    const clearField = () =>
      setCostDrafts((prev) => {
        const rowDraft = { ...(prev[a.id] ?? {}) };
        delete rowDraft[field];
        const next = { ...prev };
        if (Object.keys(rowDraft).length === 0) delete next[a.id];
        else next[a.id] = rowDraft;
        return next;
      });

    const trimmed = raw.trim();
    const value = trimmed === "" ? null : parseFloat(trimmed);
    if ((value !== null && (Number.isNaN(value) || value < 0)) || value === currentValue) {
      clearField();
      return;
    }
    startTransition(async () => {
      try {
        await setWebsitePurchaseCostAction(catalogId, a.id, "", { [COST_DB_FIELD[field]]: value });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save cost");
      } finally {
        clearField();
      }
    });
  }

  function openEdit(a: WebsiteAddon) {
    const linked = linkedDetails?.[a.id];
    setEditDraft({
      title: a.title,
      nameKm: linked?.nameKm ?? "",
      unit: linked?.unit ?? "pcs",
      unitKm: linked?.unitKm ?? "",
    });
    setEditImage(null);
    setEditImageError(null);
    setEditingId(a.id);
  }

  function handleEditImagePick(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setEditImageError("File must be an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setEditImageError("Image must be under 5MB");
      return;
    }
    setEditImageError(null);
    setEditImageUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      try {
        const { url } = await uploadWebsiteImageAction(fd);
        setEditImage(url);
      } catch (e) {
        setEditImageError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setEditImageUploading(false);
      }
    });
  }

  function saveEdit(a: WebsiteAddon) {
    if (!editDraft.title.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    setPendingId(a.id);
    startTransition(async () => {
      try {
        await setAddonDetailsAction({
          catalogId,
          addonId: a.id,
          currentTitle: a.title,
          title: editDraft.title,
          imageUrl: editImage || null,
          removeImage: editImage === "",
          currentImageUrl: a.image_url,
          price: a.price,
          stock: a.stock,
          nameKm: editDraft.nameKm,
          unit: editDraft.unit,
          unitKm: editDraft.unitKm,
        });
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      } finally {
        setPendingId(null);
      }
    });
  }

  function applyAddStock(a: WebsiteAddon) {
    const raw = addStockDrafts[a.id];
    setAddStockDrafts((prev) => {
      const next = { ...prev };
      delete next[a.id];
      return next;
    });
    if (raw === undefined || raw.trim() === "") return;
    const add = Number(raw);
    if (Number.isNaN(add) || add === 0) return;
    // Unlimited (null) has nothing to add on top of -- adding stock to one
    // starts tracking it from 0, same as a brand-new delivery.
    saveField(a, { stock: Math.max(0, (a.stock ?? 0) + add) });
  }

  function toggleStatus(a: WebsiteAddon) {
    const status: WebsiteAddonWrite["status"] = a.status === "published" ? "draft" : "published";
    setError(null);
    setPendingId(a.id);
    startTransition(async () => {
      try {
        await updateWebsiteAddonAction(catalogId, a.id, { status });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update status");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <span className="text-sm font-medium text-zinc-500">{addons.length} addon{addons.length === 1 ? "" : "s"}</span>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setShowForm((v) => !v);
          }}
          className={`shrink-0 rounded px-3 py-1.5 text-sm font-medium ${
            showForm
              ? "border border-black/[.15] dark:border-white/[.2]"
              : "bg-brand text-white hover:brightness-95"
          }`}
        >
          {showForm ? "Cancel" : "+ Add addon"}
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[.08] bg-brand/10 px-6 py-2.5 text-sm dark:border-white/[.145]">
          <span className="font-semibold">{selected.size} selected</span>
          <button
            onClick={() => bulkSetStatus("published")}
            disabled={bulkBusy}
            className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-white/[.2]"
          >
            Publish
          </button>
          <button
            onClick={() => bulkSetStatus("draft")}
            disabled={bulkBusy}
            className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium disabled:opacity-50 dark:border-white/[.2]"
          >
            Set to Draft
          </button>
          <button
            onClick={() => setConfirmBulkDelete(true)}
            disabled={bulkBusy}
            className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
          >
            Delete
          </button>
          {bulkBusy && <span className="text-xs text-zinc-500">Working…</span>}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs font-medium text-zinc-500 hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {showForm && (
        <div className="border-b border-black/[.08] bg-black/[.02] px-6 py-5 dark:border-white/[.145] dark:bg-white/[.02]">
          <h3 className="mb-4 text-sm font-semibold">New addon</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 md:grid-cols-4">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">
                Title<span className="text-red-500"> *</span>
              </span>
              <input
                type="text"
                placeholder="e.g. Extra Wasabi"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className={fieldInputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Price</span>
              <div className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1.5 focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50">
                <span className="select-none text-sm text-zinc-400">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  value={form.price ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      price: e.target.value === "" ? undefined : Number(e.target.value),
                    }))
                  }
                  className="w-full min-w-0 border-0 bg-transparent p-0 text-right text-sm tabular-nums outline-none"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">
                Stock<span className="ml-1 font-normal text-zinc-400">— blank = unlimited stock</span>
              </span>
              <input
                type="number"
                min={0}
                placeholder="—"
                value={form.stock ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    stock: e.target.value === "" ? undefined : Number(e.target.value),
                  }))
                }
                className={`${fieldInputClass} text-right tabular-nums`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Status</span>
              <select
                value={form.status ?? "draft"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as WebsiteAddonWrite["status"] }))
                }
                className={fieldInputClass}
              >
                <option value="draft">Draft — hidden on the site</option>
                <option value="published">Published — live on the site</option>
              </select>
            </label>
            <label className="col-span-2 flex flex-col gap-1 md:col-span-4">
              <span className="text-xs font-medium text-zinc-500">
                Description<span className="ml-1 font-normal text-zinc-400">— optional</span>
              </span>
              <input
                type="text"
                value={form.description ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className={fieldInputClass}
              />
            </label>
            <div className="col-span-2 flex flex-col gap-1 md:col-span-4">
              <span className="text-xs font-medium text-zinc-500">
                Image<span className="ml-1 font-normal text-zinc-400">— optional</span>
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                  {form.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                      No image
                    </div>
                  )}
                </div>
                <label className="cursor-pointer rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]">
                  {uploadingImage
                    ? "Uploading…"
                    : form.image_url
                      ? "Replace image"
                      : "Upload from computer"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingImage}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      handleImagePick(file);
                    }}
                  />
                </label>
                {form.image_url && !uploadingImage && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, image_url: "" }))}
                    className="text-xs text-red-500"
                  >
                    Remove
                  </button>
                )}
                <input
                  type="text"
                  placeholder="or paste an image URL"
                  value={form.image_url ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                  className={`${fieldInputClass} min-w-[12rem] flex-1`}
                />
              </div>
              {imageError && <span className="mt-1 text-xs text-red-500">{imageError}</span>}
            </div>
          </div>
          {formError && <p className="mt-3 text-xs text-red-500">{formError}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={submitCreate}
              className="rounded border border-black bg-black px-4 py-1.5 text-sm font-medium text-white dark:border-white dark:bg-white dark:text-black"
            >
              Create addon
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded border border-black/[.15] px-4 py-1.5 text-sm dark:border-white/[.2]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="px-6 py-3 text-sm text-red-500">{error}</p>}
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
          <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
            <th className="w-10 py-2 pl-6">
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={allOnPageSelected}
                onChange={toggleSelectPage}
                className="align-middle accent-[var(--brand)]"
              />
            </th>
            <th className="w-14 px-3 py-2 font-medium">Image</th>
            <th className="min-w-[14rem] px-3 py-2 font-medium">Addon</th>
            <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">
              Original Cost
            </th>
            <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">
              Total Cost 10%
            </th>
            <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">
              Purchase Cost
            </th>
            <th className="w-20 bg-black/[.015] px-2 py-2 text-right font-medium dark:bg-white/[.02]">
              Extra Cost
            </th>
            <th className="w-20 border-r border-black/[.08] bg-black/[.015] px-2 py-2 text-right font-medium dark:border-white/[.145] dark:bg-white/[.02]">
              Total
            </th>
            <th className="w-24 px-3 py-2 text-right font-medium">Price</th>
            <th className="w-20 px-3 py-2 text-right font-medium">Stock</th>
            <th className="w-20 px-3 py-2 text-right font-medium">Add Stock</th>
            <th className="w-32 px-3 py-2 font-medium">Status</th>
            <th className="w-16 px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {paged.map((a) => {
            const priceValue = drafts[a.id]?.price ?? String(a.price);
            const stockValue = drafts[a.id]?.stock ?? (a.stock === null ? "" : String(a.stock));
            const busy = pendingId === a.id;
            const savedCosts = purchaseCosts?.[purchaseCostKey(a.id, "")] ?? EMPTY_PURCHASE_COSTS;
            const { purchaseCost, total } = derivePurchaseCost(savedCosts);
            const draft = costDrafts[a.id];
            const costText = (v: number | null) => (v === null ? "" : String(v));
            const fallback = fallbackCosts?.[a.id];
            const totalPlaceholder =
              savedCosts.totalOverride !== null
                ? "—"
                : (total ?? fallback) != null
                  ? (total ?? (fallback as number)).toFixed(2)
                  : "—";
            const costBox = (field: CostField, value: string, saved: number | null, placeholder = "—") => (
              <label className={costInputClass}>
                <span className="select-none text-zinc-400">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={placeholder}
                  value={value}
                  onChange={(e) =>
                    setCostDrafts((prev) => ({ ...prev, [a.id]: { ...prev[a.id], [field]: e.target.value } }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={() => saveCostField(a, field, saved)}
                  className="w-full min-w-0 bg-transparent text-right outline-none"
                />
              </label>
            );
            return (
              <tr
                key={a.id}
                className={`border-b border-black/[.06] align-top dark:border-white/[.08] ${
                  selected.has(a.id) ? "bg-brand/5" : ""
                }`}
              >
                <td className="py-2 pl-6">
                  <input
                    type="checkbox"
                    aria-label={`Select ${a.title}`}
                    checked={selected.has(a.id)}
                    onChange={() => toggleSelected(a.id)}
                    className="align-middle accent-[var(--brand)]"
                  />
                </td>
                <td className="px-3 py-2">
                  {a.image_url ? (
                    <button
                      type="button"
                      onClick={() => onPreviewImage?.({ url: a.image_url as string, title: a.title })}
                      className="block h-10 w-10 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.image_url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-black/[.1] bg-zinc-100 text-[9px] text-zinc-400 dark:border-white/[.15] dark:bg-zinc-800">
                      No img
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{a.title}</div>
                  {(linkedDetails?.[a.id]?.nameKm || linkedDetails?.[a.id]?.unitKm) && (
                    <div className="text-xs text-zinc-500">
                      {linkedDetails?.[a.id]?.nameKm && <span lang="km">{linkedDetails[a.id].nameKm} </span>}
                      <span>
                        {linkedDetails?.[a.id]?.unit}
                        {linkedDetails?.[a.id]?.unitKm && (
                          <>
                            {" · "}
                            <span lang="km">{linkedDetails[a.id].unitKm}</span>
                          </>
                        )}
                      </span>
                    </div>
                  )}
                  {a.description && <div className="text-xs text-zinc-400">{a.description}</div>}
                  {editingId === a.id && (
                    <div className="mt-2 space-y-2 rounded-lg border border-black/[.1] bg-black/[.02] p-3 dark:border-white/[.15] dark:bg-white/[.03]">
                      <label className="block text-xs text-zinc-500">
                        Name now
                        <input
                          type="text"
                          value={editDraft.title}
                          onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))}
                          className="mt-0.5 w-full rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm text-foreground dark:border-white/[.2]"
                        />
                      </label>
                      <label className="block text-xs text-zinc-500">
                        Name in Khmer
                        <input
                          type="text"
                          lang="km"
                          placeholder="ឈ្មោះជាភាសាខ្មែរ"
                          value={editDraft.nameKm}
                          onChange={(e) => setEditDraft((d) => ({ ...d, nameKm: e.target.value }))}
                          className="mt-0.5 w-full rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm text-foreground dark:border-white/[.2]"
                        />
                      </label>
                      <label className="block text-xs text-zinc-500">
                        Scale
                        <select
                          value={editDraft.unit}
                          onChange={(e) => setEditDraft((d) => ({ ...d, unit: e.target.value }))}
                          className="mt-0.5 w-full rounded border border-black/[.15] bg-card px-2 py-1 text-sm text-foreground dark:border-white/[.2]"
                        >
                          {[...new Set([...ENGLISH_SCALES, editDraft.unit])].map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs text-zinc-500">
                        Scale in Khmer
                        <select
                          lang="km"
                          value={editDraft.unitKm}
                          onChange={(e) => setEditDraft((d) => ({ ...d, unitKm: e.target.value }))}
                          className="mt-0.5 w-full rounded border border-black/[.15] bg-card px-2 py-1 text-sm text-foreground dark:border-white/[.2]"
                        >
                          <option value="">—</option>
                          {[...new Set([...KHMER_SCALES, editDraft.unitKm].filter(Boolean))].map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="block text-xs text-zinc-500">
                        Image
                        <div className="mt-0.5 flex items-center gap-3">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                            {(editImage === "" ? null : (editImage ?? a.image_url)) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={(editImage === "" ? null : (editImage ?? a.image_url)) as string}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                                No image
                              </div>
                            )}
                          </div>
                          <label className="cursor-pointer rounded border border-black/[.15] px-3 py-1.5 text-sm text-foreground dark:border-white/[.2]">
                            {editImageUploading
                              ? "Uploading…"
                              : editImage || (editImage === null && a.image_url)
                                ? "Replace image"
                                : "Upload image"}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={editImageUploading}
                              onChange={(e) => {
                                const file = e.target.files?.[0] ?? null;
                                e.target.value = "";
                                handleEditImagePick(file);
                              }}
                            />
                          </label>
                        </div>
                        {/* Always shown; greyed out while there is no picture to remove. */}
                        <button
                          type="button"
                          onClick={() => setEditImage("")}
                          disabled={editImageUploading || (editImage === "" ? true : !(editImage ?? a.image_url))}
                          className="mt-1.5 block text-xs font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40 dark:text-red-400"
                        >
                          Remove image
                        </button>
                        {editImage && (
                          <span className="mt-1 block text-[11px] text-zinc-500">
                            New picture -- it replaces the old one when you press Save.
                          </span>
                        )}
                        {editImage === "" && (
                          <span className="mt-1 block text-[11px] text-zinc-500">
                            The picture will be removed when you press Save.
                          </span>
                        )}
                        {editImageError && <span className="mt-1 block text-red-500">{editImageError}</span>}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          disabled={busy}
                          className="rounded-full border border-black/[.15] px-3 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-50 dark:border-white/[.2] dark:hover:bg-white/[.06]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(a)}
                          disabled={busy || editImageUploading}
                          className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </td>
                <td className={costCellClass}>
                  {costBox("original", draft?.original ?? costText(savedCosts.originalCost), savedCosts.originalCost)}
                </td>
                <td className={costCellClass}>
                  {costBox("total10", draft?.total10 ?? costText(savedCosts.totalCost10pct), savedCosts.totalCost10pct)}
                </td>
                <td className={`${costCellClass} tabular-nums text-zinc-500`}>
                  {purchaseCost === null ? "—" : formatMoney(purchaseCost)}
                </td>
                <td className={costCellClass}>
                  {costBox("extra", draft?.extra ?? costText(savedCosts.extraMoney), savedCosts.extraMoney)}
                </td>
                <td className="border-r border-black/[.08] bg-black/[.015] px-2 py-2 text-right dark:border-white/[.145] dark:bg-white/[.02]">
                  {costBox(
                    "total",
                    draft?.total ?? costText(savedCosts.totalOverride),
                    savedCosts.totalOverride,
                    totalPlaceholder
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <label className="inline-flex w-20 items-center gap-1 rounded border border-black/[.15] px-2 py-1 text-sm focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50">
                    <span className="select-none text-zinc-400">$</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={priceValue}
                      disabled={busy}
                      onChange={(e) => setDraft(a.id, "price", e.target.value)}
                      onBlur={(e) => savePrice(a, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className="w-full min-w-0 border-0 bg-transparent p-0 text-right tabular-nums outline-none"
                    />
                  </label>
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    placeholder="—"
                    title="Blank = unlimited stock"
                    value={stockValue}
                    disabled={busy}
                    onChange={(e) => setDraft(a.id, "stock", e.target.value)}
                    onBlur={(e) => saveStock(a, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="w-16 rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm tabular-nums focus:border-black/40 focus:outline-none dark:border-white/[.2] dark:focus:border-white/50"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    title={
                      a.stock === null
                        ? "Unlimited stock -- adding starts tracking it from 0"
                        : "Adds to the current stock on save -- e.g. a delivery of 2 on top of 5 becomes 7"
                    }
                    placeholder="0"
                    value={addStockDrafts[a.id] ?? ""}
                    disabled={busy}
                    onChange={(e) => setAddStockDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    onBlur={() => applyAddStock(a)}
                    className="w-16 rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm tabular-nums focus:border-black/40 focus:outline-none disabled:opacity-40 dark:border-white/[.2] dark:focus:border-white/50"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggleStatus(a)}
                    title="Click to toggle Published / Draft"
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      a.status === "published"
                        ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-zinc-500/10 text-zinc-500 hover:bg-zinc-500/20 dark:text-zinc-400"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        a.status === "published" ? "bg-emerald-500" : "bg-zinc-400"
                      }`}
                    />
                    {a.status === "published" ? "Published" : "Draft"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => (editingId === a.id ? setEditingId(null) : openEdit(a))}
                    title="Edit name, Khmer name, scale and image"
                    aria-label="Edit"
                    aria-expanded={editingId === a.id}
                    className="mr-1 inline-flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-black/[.05] hover:text-foreground dark:hover:bg-white/[.08]"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setConfirmDeleteAddon(a);
                    }}
                    className="rounded p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {paged.length === 0 && (
            <tr>
              <td colSpan={13} className="px-6 py-8 text-center text-sm text-zinc-500">
                No add-ons.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {addons.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[.08] px-6 py-3 text-sm dark:border-white/[.145]">
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Items per page
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded border border-black/[.15] bg-card px-2 py-1 text-xs text-foreground dark:border-white/[.2]"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1 text-xs disabled:opacity-30 dark:border-white/[.2]"
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </button>
            <span className="tabular-nums text-zinc-500">
              Page {currentPage} of {pageCount}
            </span>
            <button
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="flex items-center gap-1 rounded border border-black/[.15] px-2.5 py-1 text-xs disabled:opacity-30 dark:border-white/[.2]"
            >
              Next
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {confirmDeleteAddon && (
        <DeleteWebsiteAddonDialog
          catalogId={catalogId}
          addonId={confirmDeleteAddon.id}
          title={confirmDeleteAddon.title}
          onClose={() => setConfirmDeleteAddon(null)}
        />
      )}

      {confirmBulkDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!bulkBusy) setConfirmBulkDelete(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete selected addons"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
              <TriangleAlert className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">
              Delete {selected.size} addon{selected.size === 1 ? "" : "s"}?
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              This removes them from the storefront for good. This can&apos;t be undone.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setConfirmBulkDelete(false)}
                className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={bulkDelete}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {bulkBusy ? "Deleting…" : "Delete all"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
