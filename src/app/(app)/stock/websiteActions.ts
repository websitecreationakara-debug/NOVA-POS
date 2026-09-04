"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  createWebsiteProduct,
  deleteWebsiteProduct,
  listWebsiteProducts,
  updateWebsiteProduct,
} from "@/lib/websiteProducts/client";
import type {
  WebsiteCatalogId,
  WebsiteProduct,
  WebsiteProductWrite,
} from "@/lib/websiteProducts/types";

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

export async function deleteWebsiteProductAction(
  catalogId: WebsiteCatalogId,
  id: string
): Promise<void> {
  await deleteWebsiteProduct(catalogId, id);
  revalidatePath("/stock");
}
