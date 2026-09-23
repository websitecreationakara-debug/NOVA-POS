export type WebsiteProductStatus = "draft" | "published";
// "variant" and "variable" mean the same thing; catalogs disagree on the word.
export type WebsiteProductType = "simple" | "variant" | "variable";

// A storefront catalog exposed over its own HTTP API (Cloudflare Worker),
// separate from this app's Supabase `products` table. Each brand's website is
// its own catalog; see CATALOGS in ./catalogs.
export type WebsiteCatalogId = "sorasake" | "bosba_drink_snack" | "bosba_premium_food";

// One size/flavor option of a "variable"/"variant" type WebsiteProduct. The
// parent product's own price/stock are meaningless for these (always 0/null)
// -- the real sellable price and stock live here, per variation.
export type WebsiteProductVariation = {
  id: string;
  weight: string | null;
  flavor: string | null;
  price: number;
  sale_price: number | null;
  image_url: string | null;
  stock: number | null;
  pcs: number | null;
};

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
  // Comma-separated free text, e.g. "Chili, Garlic". Not returned by every
  // catalog.
  taste_notes?: string | null;
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
  variations?: WebsiteProductVariation[];
  images?: unknown[];
  tabs?: unknown[];
};

// A storefront's small separate add-on catalog (rice, sauce, extra ikura,
// ...) -- optional extras a cashier can ring up alongside (or instead of) a
// regular product. Managed here in Stock (create/edit/delete) or on the
// storefront's own admin -- see listWebsiteAddons/createWebsiteAddon/etc. in
// ./client.
export type WebsiteAddon = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  image_url: string | null;
  stock: number | null;
  status: WebsiteProductStatus;
  sort_order: number;
};

// A storefront category, straight from its own `categories` table (flat,
// self-referencing via `parent_id`) -- see listWebsiteCategories. Read-only:
// categories are still created/edited/deleted on each storefront's own admin,
// this app only mirrors the list so Stock's chips stay in sync automatically.
export type WebsiteCategory = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  image_url: string | null;
};

export type WebsiteAddonWrite = {
  title: string;
  description?: string | null;
  price?: number;
  image_url?: string | null;
  stock?: number | null;
  status?: WebsiteProductStatus;
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
  taste_notes?: string | null;
  pcs?: number | null;
  type?: WebsiteProductType;
  sort_order?: number;
  featured?: boolean;
  promotion_id?: string | null;
  video_url?: string | null;
  pre_order?: boolean;
};
