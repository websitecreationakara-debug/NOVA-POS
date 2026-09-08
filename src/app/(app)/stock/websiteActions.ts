"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ensurePosProductForSiteProduct } from "@/app/(app)/sales/websiteActions";
import {
  createWebsiteProduct,
  deleteWebsiteProduct,
  deleteWebsiteProductVariation,
  listWebsiteProducts,
  updateWebsiteProduct,
  updateWebsiteProductVariation,
} from "@/lib/websiteProducts/client";
import type {
  WebsiteCatalogId,
  WebsiteProduct,
  WebsiteProductWrite,
} from "@/lib/websiteProducts/types";
import { adjustStockAction, setProductPriceAction } from "./actions";

// Upload an image chosen from the user's computer to the public product-images
// bucket and hand back its URL, which then goes into a website product's
// image_url. Same bucket the POS catalog uses (migration 0010).
export async function uploadWebsiteImageAction(formData: FormData): Promise<{ url: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file");
  if (!file.type.startsWith("image/")) throw new Error("File must be an image");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5MB");

  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `website/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from("product-images").getPublicUrl(path);
  return { url: publicUrl };
}

export async function listWebsiteProductsAction(
  catalogId: WebsiteCatalogId
): Promise<WebsiteProduct[]> {
  return listWebsiteProducts(catalogId);
}

export async function createWebsiteProductAction(
  catalogId: WebsiteCatalogId,
  input: WebsiteProductWrite
): Promise<{ id: string }> {
  const result = await createWebsiteProduct(catalogId, input);
  revalidatePath("/stock");
  return result;
}

export async function updateWebsiteProductAction(
  catalogId: WebsiteCatalogId,
  id: string,
  input: Partial<WebsiteProductWrite>
): Promise<void> {
  await updateWebsiteProduct(catalogId, id, input);
  revalidatePath("/stock");
}

// The storefront now has a real endpoint for a single variation
// (PATCH /api/products/:id/variations/:variationId -- see server.ts in the
// BOSBA Drink & Snack repo), so this writes the website first -- the source
// of truth for this size's price -- and only mirrors into POS's own linked
// product (the same record Sales creates the first time someone sells that
// size, see ensurePosProductForSiteProduct) once that succeeds. If the
// website write fails (e.g. a catalog that hasn't added the route yet), the
// whole action throws and POS's own data is left untouched, so the two never
// drift apart silently.
export async function setVariationPriceAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  variationId: string;
  title: string;
  imageUrl: string | null;
  alreadyLinked: boolean;
  // Only used to seed stock if this is the first edit and no POS product
  // exists for this size yet.
  seedStock: number | null;
  price: number;
}): Promise<void> {
  await updateWebsiteProductVariation(input.catalogId, input.siteProductId, input.variationId, {
    price: input.price,
  });

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.siteProductId,
    variationId: input.variationId,
    title: input.title,
    price: input.price,
    imageUrl: input.imageUrl,
    stock: input.seedStock,
  });
  // ensurePosProductForSiteProduct only sets price at creation time -- if the
  // link already existed (at a different price), apply the new price now.
  if (input.alreadyLinked) {
    await setProductPriceAction({ productId: linked.id, price: input.price });
  }
}

export async function setVariationStockAction(input: {
  catalogId: WebsiteCatalogId;
  siteProductId: string;
  variationId: string;
  title: string;
  imageUrl: string | null;
  alreadyLinked: boolean;
  // Only used to seed price if this is the first edit and no POS product
  // exists for this size yet.
  seedPrice: number;
  // The POS product's stock right now (0 if not yet linked) -- used to turn
  // the typed absolute value into the delta adjustStockAction expects.
  currentStock: number;
  stock: number;
}): Promise<void> {
  await updateWebsiteProductVariation(input.catalogId, input.siteProductId, input.variationId, {
    stock: input.stock,
  });

  const linked = await ensurePosProductForSiteProduct({
    catalogId: input.catalogId,
    siteProductId: input.siteProductId,
    variationId: input.variationId,
    title: input.title,
    price: input.seedPrice,
    imageUrl: input.imageUrl,
    stock: input.stock,
  });
  // ensurePosProductForSiteProduct seeds stock directly at creation time (to
  // the target value already) -- only need an explicit adjustment if the
  // link already existed.
  if (input.alreadyLinked) {
    const delta = input.stock - input.currentStock;
    if (delta !== 0) {
      await adjustStockAction({ productId: linked.id, delta, reason: "Stock page edit" });
    }
  }
}

export async function deleteWebsiteProductAction(
  catalogId: WebsiteCatalogId,
  id: string
): Promise<void> {
  await deleteWebsiteProduct(catalogId, id);
  revalidatePath("/stock");
}

// Removes just one size of a "variable" product; the product and its other
// sizes stay on the site. Deleting the last remaining size is left to the
// storefront to handle (it keeps an empty variable product).
export async function deleteWebsiteProductVariationAction(
  catalogId: WebsiteCatalogId,
  productId: string,
  variationId: string
): Promise<void> {
  await deleteWebsiteProductVariation(catalogId, productId, variationId);
  revalidatePath("/stock");
}
