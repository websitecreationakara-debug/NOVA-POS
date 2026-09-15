"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import type { WebsiteAddon, WebsiteAddonWrite, WebsiteCatalogId } from "@/lib/websiteProducts/types";
import {
  createWebsiteAddonAction,
  updateWebsiteAddonAction,
  uploadWebsiteImageAction,
} from "@/app/(app)/stock/websiteActions";
import DeleteWebsiteAddonDialog from "@/components/DeleteWebsiteAddonDialog";

function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

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
}: {
  catalogId: WebsiteCatalogId;
  addons: WebsiteAddon[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteAddon, setConfirmDeleteAddon] = useState<WebsiteAddon | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [stockDraft, setStockDraft] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WebsiteAddonWrite>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pageCount = Math.max(1, Math.ceil(addons.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = addons.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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

  function startEdit(a: WebsiteAddon) {
    setError(null);
    setEditingId(a.id);
    setPriceDraft(String(a.price));
    setStockDraft(a.stock === null ? "" : String(a.stock));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function save(a: WebsiteAddon) {
    const price = parseFloat(priceDraft);
    if (Number.isNaN(price) || price < 0) {
      setError("Price must be a non-negative number");
      return;
    }
    const trimmedStock = stockDraft.trim();
    const stock = trimmedStock === "" ? null : parseFloat(trimmedStock);
    if (stock !== null && (Number.isNaN(stock) || stock < 0)) {
      setError("Stock must be a non-negative number, or blank for untracked");
      return;
    }
    const input: { price?: number; stock?: number | null } = {};
    if (price !== a.price) input.price = price;
    if (stock !== a.stock) input.stock = stock;
    if (Object.keys(input).length === 0) {
      setEditingId(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await updateWebsiteAddonAction(catalogId, a.id, input);
        router.refresh();
        setEditingId(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
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
              : "bg-brand text-black hover:brightness-95"
          }`}
        >
          {showForm ? "Cancel" : "+ Add addon"}
        </button>
      </div>

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
                Stock<span className="ml-1 font-normal text-zinc-400">— blank = untracked</span>
              </span>
              <input
                type="number"
                min={0}
                placeholder="untracked"
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
            <th className="w-14 px-3 py-2 pl-6 font-medium">Image</th>
            <th className="px-3 py-2 font-medium">Addon</th>
            <th className="w-28 px-3 py-2 text-right font-medium">Price</th>
            <th className="w-20 px-3 py-2 text-right font-medium">Stock</th>
            <th className="w-32 px-3 py-2 font-medium">Status</th>
            <th className="w-16 px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {paged.map((a) => {
            const editing = editingId === a.id;
            return (
              <tr key={a.id} className="border-b border-black/[.06] align-top dark:border-white/[.08]">
                <td className="px-3 py-2 pl-6">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                    {a.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                        No img
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{a.title}</div>
                  {a.description && <div className="text-xs text-zinc-400">{a.description}</div>}
                </td>
                {editing ? (
                  <>
                    <td className="px-3 py-2 text-right">
                      <label className="inline-flex w-24 items-center gap-1 rounded border border-black/[.15] px-2 py-1 text-sm focus-within:border-black/40 dark:border-white/[.2] dark:focus-within:border-white/50">
                        <span className="select-none text-zinc-400">$</span>
                        <input
                          autoFocus
                          type="number"
                          min={0}
                          step="0.01"
                          value={priceDraft}
                          onChange={(e) => setPriceDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") save(a);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="w-full bg-transparent text-right outline-none"
                        />
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        placeholder="untracked"
                        value={stockDraft}
                        onChange={(e) => setStockDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") save(a);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-right text-sm dark:border-white/[.2]"
                      />
                    </td>
                    <td className="px-3 py-2 capitalize">{a.status}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Save"
                          disabled={isPending}
                          onClick={() => save(a)}
                          className="rounded p-1 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/40"
                        >
                          <Check className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Cancel"
                          onClick={cancelEdit}
                          className="rounded p-1 text-zinc-500 hover:bg-black/[.06] dark:hover:bg-white/[.1]"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="rounded px-1 py-0.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]"
                      >
                        {formatMoney(a.price)}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="rounded px-1 py-0.5 hover:bg-black/[.05] dark:hover:bg-white/[.08]"
                      >
                        {a.stock === null ? "—" : a.stock}
                      </button>
                    </td>
                    <td className="px-3 py-2 capitalize">{a.status}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => {
                          setError(null);
                          setEditingId(null);
                          setConfirmDeleteAddon(a);
                        }}
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
          {paged.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-8 text-center text-sm text-zinc-500">
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
    </>
  );
}
