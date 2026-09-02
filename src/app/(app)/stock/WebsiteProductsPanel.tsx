"use client";

import { useState, useTransition } from "react";
import type {
  WebsiteCatalogId,
  WebsiteProduct,
  WebsiteProductWrite,
} from "@/lib/websiteProducts/types";
import {
  createWebsiteProductAction,
  deleteWebsiteProductAction,
  listWebsiteProductsAction,
  updateWebsiteProductAction,
} from "./websiteActions";

const emptyForm: WebsiteProductWrite = {
  title: "",
  description: "",
  price: 0,
  category_id: "",
  stock: 0,
  status: "draft",
  image_url: "",
  weight: "",
  type: "simple",
  featured: false,
};

export default function WebsiteProductsPanel({
  catalogId,
  catalogLabel,
  initialProducts,
  initialError,
}: {
  catalogId: WebsiteCatalogId;
  catalogLabel: string;
  initialProducts: WebsiteProduct[] | null;
  initialError: string | null;
}) {
  const [products, setProducts] = useState<WebsiteProduct[] | null>(initialProducts);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WebsiteProductWrite>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function load() {
    setLoadError(null);
    startTransition(async () => {
      try {
        const data = await listWebsiteProductsAction(catalogId);
        setProducts(data);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load website products");
      }
    });
  }

  function submitCreate() {
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    setFormError(null);
    startTransition(async () => {
      try {
        await createWebsiteProductAction(catalogId, {
          ...form,
          title: form.title.trim(),
          price: Number(form.price) || 0,
          stock: form.stock === null || form.stock === undefined ? null : Number(form.stock),
        });
        setForm(emptyForm);
        setShowForm(false);
        load();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Failed to create product");
      }
    });
  }

  function patch(id: string, input: Partial<WebsiteProductWrite>) {
    setPendingId(id);
    startTransition(async () => {
      try {
        await updateWebsiteProductAction(catalogId, id, input);
        load();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to update product");
      } finally {
        setPendingId(null);
      }
    });
  }

  function remove(id: string, title: string) {
    if (!window.confirm(`Delete "${title}" from the website? This cannot be undone.`)) return;
    setPendingId(id);
    startTransition(async () => {
      try {
        await deleteWebsiteProductAction(catalogId, id);
        load();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to delete product");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-black/[.08] px-6 py-3 dark:border-white/[.145]">
        <h2 className="text-sm font-medium text-zinc-500">{catalogLabel} products</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]"
        >
          {showForm ? "Cancel" : "Add product"}
        </button>
        <button
          onClick={load}
          className="rounded border border-black/[.15] px-3 py-1.5 text-sm dark:border-white/[.2]"
        >
          Refresh
        </button>
      </div>

      {showForm && (
        <div className="border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input
              type="text"
              placeholder="Title *"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Price"
              value={form.price ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="number"
              min={0}
              placeholder="Stock"
              value={form.stock ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value) }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <select
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value as WebsiteProductWrite["status"] }))
              }
              className="rounded border border-black/[.15] bg-card px-2 py-1.5 text-sm dark:border-white/[.2]"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
            <input
              type="text"
              placeholder="Weight (e.g. 500ml)"
              value={form.weight ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Category UUID (optional)"
              value={form.category_id ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <input
              type="text"
              placeholder="Image URL"
              value={form.image_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
              className="rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2]"
            />
            <label className="flex items-center gap-1.5 text-sm text-zinc-500">
              <input
                type="checkbox"
                checked={form.featured ?? false}
                onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
              />
              Featured
            </label>
            <textarea
              placeholder="Description"
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="col-span-2 rounded border border-black/[.15] bg-transparent px-2 py-1.5 text-sm dark:border-white/[.2] md:col-span-4"
              rows={2}
            />
          </div>
          {formError && <p className="mt-2 text-xs text-red-500">{formError}</p>}
          <button
            onClick={submitCreate}
            className="mt-3 rounded border border-black bg-black px-3 py-1.5 text-sm text-white dark:border-white dark:bg-white dark:text-black"
          >
            Create
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loadError && <p className="px-6 py-3 text-sm text-red-500">{loadError}</p>}
        {products === null && !loadError && (
          <p className="px-6 py-8 text-center text-sm text-zinc-500">Loading…</p>
        )}
        {products && (
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
              <tr className="border-b border-black/[.08] text-left text-xs text-zinc-500 dark:border-white/[.145]">
                <th className="px-6 py-2 font-medium">Image</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Price</th>
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Featured</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-black/[.06] align-top dark:border-white/[.08]"
                >
                  <td className="px-6 py-2">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-black/[.1] bg-zinc-100 dark:border-white/[.15] dark:bg-zinc-800">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-400">
                          No img
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-2">
                    <div className="font-medium">{p.title}</div>
                    {p.weight && <div className="text-xs text-zinc-400">{p.weight}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-400">$</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={p.price}
                        disabled={pendingId === p.id}
                        onBlur={(e) => {
                          const price = Number(e.target.value);
                          if (!Number.isNaN(price) && price !== p.price) patch(p.id, { price });
                        }}
                        className="w-20 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      defaultValue={p.stock ?? 0}
                      disabled={pendingId === p.id}
                      onBlur={(e) => {
                        const stock = Number(e.target.value);
                        if (!Number.isNaN(stock) && stock !== p.stock) patch(p.id, { stock });
                      }}
                      className="w-16 rounded border border-black/[.15] bg-transparent px-2 py-1 text-sm dark:border-white/[.2]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={p.status}
                      disabled={pendingId === p.id}
                      onChange={(e) =>
                        patch(p.id, { status: e.target.value as WebsiteProductWrite["status"] })
                      }
                      className="rounded border border-black/[.15] bg-card px-2 py-1 text-sm dark:border-white/[.2]"
                    >
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={p.featured}
                      disabled={pendingId === p.id}
                      onChange={(e) => patch(p.id, { featured: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      disabled={pendingId === p.id}
                      onClick={() => remove(p.id, p.title)}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-500 disabled:opacity-40 dark:border-red-900"
                    >
                      {pendingId === p.id ? "…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-zinc-500">
                    No website products yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
