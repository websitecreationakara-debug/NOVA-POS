export type WebsiteProductStatus = "draft" | "published";
// "variant" and "variable" mean the same thing; catalogs disagree on the word.
export type WebsiteProductType = "simple" | "variant" | "variable";

// A storefront catalog exposed over its own HTTP API (Cloudflare Worker),
// separate from this app's Supabase `products` table. Each brand's website is
// its own catalog; see CATALOGS in ./catalogs.
export type WebsiteCatalogId = "sorasake" | "bosba_drink_snack" | "bosba_premium_food";

// Storefront product. Fields below `video_url` are only returned by some
// catalogs (BOSBA Drink & Snack), so they're optional.
export type WebsiteProduct = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  sale_price: number | null;
  category_id: string | null;
  stock: number | null;
  status: WebsiteProductStatus;
  image_url: string | null;
  badge: string | null;
  rating: number | null;
  weight: string | null;
  pcs: number | null;
  type: WebsiteProductType;
  sort_order: number;
  featured: boolean;
  promotion_id: string | null;
  video_url: string | null;
  slug?: string;
  pre_order?: boolean;
  created_at?: string;
  updated_at?: string;
  variations?: unknown[];
  images?: unknown[];
  tabs?: unknown[];
};

export type WebsiteProductWrite = {
  title: string;
  description?: string | null;
  price?: number;
  sale_price?: number | null;
  category_id?: string | null;
  stock?: number | null;
  status?: WebsiteProductStatus;
  image_url?: string | null;
  badge?: string | null;
  rating?: number | null;
  weight?: string | null;
  pcs?: number | null;
  type?: WebsiteProductType;
  sort_order?: number;
  featured?: boolean;
  promotion_id?: string | null;
  video_url?: string | null;
  pre_order?: boolean;
};
