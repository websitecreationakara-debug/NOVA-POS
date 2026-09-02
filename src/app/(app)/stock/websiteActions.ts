"use server";

import { revalidatePath } from "next/cache";
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
