import type { PaymentMethod } from "@/lib/paymentMethods";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type StaffRole = "admin" | "sales" | "stock" | "accountance" | "marketing";

// Job-title labels shown in the UI. The stored role values above are unchanged
// (access checks, middleware, and existing accounts all key off them) -- this
// is display only.
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Administration",
  sales: "Sale Customer Support",
  stock: "Stock Operation",
  accountance: "Cooperate Admin",
  marketing: "Marketing Promotion",
};

export function staffRoleLabel(role: string): string {
  return (STAFF_ROLE_LABELS as Record<string, string>)[role] ?? role;
}
// Re-exported for compatibility with existing importers -- the canonical
// definition (plus labels/checkout list) lives in @/lib/paymentMethods.
export type { PaymentMethod } from "@/lib/paymentMethods";
export type OrderStatus = "open" | "paid" | "voided";
export type FulfillmentStatus =
  | "pre_order"
  | "new_order"
  | "processing"
  | "delivered"
  | "cancelled"
  | "complete";
export type DiscountType = "percent" | "fixed";

export type Brand = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  full_name: string;
  role: StaffRole;
  created_at: string;
};

export type Category = {
  id: string;
  brand_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type Product = {
  id: string;
  brand_id: string;
  category_id: string | null;
  sku: string | null;
  name: string;
  price: number;
  unit: string;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Per-unit cost -- used for direct COGS when the product has no recipe.
  // null = cost not recorded yet, treated as "unknown", never as $0.
  cost_price: number | null;
  // Hides this product from the Sales checkout grid while keeping it
  // manageable in Stock -- for raw materials/packaging used only as a
  // recipe ingredient, not sold on their own.
  is_ingredient: boolean;
  // Grams one unit of this product (e.g. one "pcs") weighs -- lets Cost
  // Control Set lines convert Scale to kg/g. null = unknown.
  weight_grams: number | null;
};

export type RecipeItem = {
  id: string;
  product_id: string;
  ingredient_product_id: string;
  quantity: number;
  created_at: string;
};

// Snapshot of one ingredient's consumption (and cost) for one order line --
// see order_item_ingredients in migration 0026. Lets a cancelled/deleted
// order restore ingredient stock precisely even if the recipe has since
// changed.
export type OrderItemIngredient = {
  id: string;
  order_item_id: string;
  ingredient_product_id: string;
  quantity: number;
  unit_cost: number | null;
  created_at: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  second_phone: string | null;
  email: string | null;
  notes: string | null;
  photo_url: string | null;
  address: string | null;
  customer_since: string | null;
  first_name: string | null;
  last_name: string | null;
  page_uid: string | null;
  source: string | null;
  label: string | null;
  capital: string | null;
  state: string | null;
  dob: string | null;
  yob: number | null;
  age: number | null;
  gender: string | null;
  nationality: string | null;
  created_at: string;
};

export type StockLevel = {
  product_id: string;
  quantity: number;
  low_stock_threshold: number;
  updated_at: string;
};

export type ProductSiteLink = {
  id: string;
  product_id: string;
  site: "bosba-premium-foods" | "bosba-drink-snack" | "sora-sake";
  site_product_id: string;
  // "" for a simple site product. For a "variable" site product, the
  // specific variation this row links -- see migration 0018.
  variation_id: string;
  matched_name: string | null;
  match_confidence: "exact" | "loose";
  created_at: string;
};

// Manually-entered purchase-cost breakdown for one storefront item (Stock >
// Website product table), independent of whether it has a linked POS
// product yet -- see migration 0027. Purchase Cost and Total are derived in
// the app (never stored): Purchase Cost = (original_cost + total_cost_10pct)
// / 2, Total = Purchase Cost + extra_money.
export type WebsiteProductPurchaseCost = {
  id: string;
  site: "bosba-premium-foods" | "bosba-drink-snack" | "sora-sake";
  site_product_id: string;
  // "" for a simple site product; a variation's own id for one size/flavor
  // of a "variable" product -- mirrors product_site_links.variation_id.
  variation_id: string;
  original_cost: number | null;
  total_cost_10pct: number | null;
  extra_money: number | null;
  updated_at: string;
};

// Marketing > Cost Control: a bundle of existing Stock products sold/costed
// as one unit (e.g. a gift box). Total Cost and Margin % are always derived
// from `SetItem`s + suggested_sell_price -- never stored -- see
// lib/costControl.ts.
export type SetStatus = "draft" | "active";

export type ProductSet = {
  id: string;
  brand_id: string;
  code: string;
  name: string;
  suggested_sell_price: number | null;
  status: SetStatus;
  created_at: string;
  updated_at: string;
};

// One line item (an existing product + amount) inside a Set. unit/unit_cost
// are a snapshot from the product at add-time (or last refresh), editable
// independently so a later catalog change doesn't silently reprice an
// already-built set.
export type SetItem = {
  id: string;
  set_id: string;
  product_id: string;
  amount: number;
  unit: string;
  unit_cost: number | null;
  sort_order: number;
  created_at: string;
};

export type StockAdjustmentCategory = "waste" | "promotion" | "other";

export type StockAdjustment = {
  id: string;
  product_id: string;
  delta: number;
  reason: string;
  created_by: string | null;
  created_at: string;
  category: StockAdjustmentCategory;
  // Cost of stock that left uncompensated (waste/promo), snapshotted from
  // the product's cost_price at adjustment time. null if no cost price was
  // set, or the adjustment added stock back (positive delta).
  cost_impact: number | null;
};

export type Promotion = {
  id: string;
  brand_id: string | null;
  code: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type Order = {
  id: string;
  brand_id: string;
  customer_id: string | null;
  status: OrderStatus;
  fulfillment_status: FulfillmentStatus;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  delivery_fee: number;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  created_by: string | null;
  created_at: string;
  paid_at: string | null;
  // Customer-requested delivery date & time (ISO); null = ASAP / same day.
  delivery_at: string | null;
  invoice_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  // Customer-requested delivery date (no time); null = ASAP / same day.
  delivery_date: string | null;
  // Free-text note / description for the order (migration 0021).
  note: string | null;
  // "pos" (default, staff-charged) | "online" (created by a storefront via
  // create_online_order() -- see the "online_order_sync" migration, which
  // added this and the two columns below). site/site_order_id are only set
  // for "online" orders -- together they're how /api/order-sync,
  // /api/order-status-sync, and create_online_order() itself find/dedupe a
  // given storefront order.
  channel: string;
  site: string | null;
  site_order_id: string | null;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  // Cost snapshot taken at sale time (see migration 0026) -- read back for
  // margin reporting, never recomputed from the product's current
  // cost_price, so editing a cost price today can't rewrite past COGS.
  // Both null when the cost was unknown at sale time.
  unit_cost: number | null;
  cogs: number | null;
  cost_source: "direct" | "recipe" | null;
};

export type Expense = {
  id: string;
  brand_id: string;
  description: string;
  amount: number;
  category: string | null;
  expense_date: string;
  created_by: string | null;
  created_at: string;
};

export type CashReconciliation = {
  id: string;
  brand_id: string;
  reconciliation_date: string;
  expected_cash: number;
  expected_bank_qr: number;
  counted_cash: number;
  variance: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

type Table<Row, Insert, Relationships extends readonly unknown[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: Relationships;
};

export type Database = {
  public: {
    Tables: {
      brands: Table<Brand, Omit<Brand, "id" | "created_at"> & Partial<Pick<Brand, "id">>>;
      profiles: Table<Profile, Omit<Profile, "created_at">>;
      categories: Table<
        Category,
        Omit<Category, "id" | "created_at"> & Partial<Pick<Category, "id" | "sort_order">>,
        [
          {
            foreignKeyName: "categories_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ]
      >;
      products: Table<
        Product,
        Omit<Product, "id" | "created_at" | "updated_at" | "cost_price" | "is_ingredient" | "weight_grams"> &
          Partial<Pick<Product, "id" | "cost_price" | "is_ingredient" | "weight_grams">>,
        [
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ]
      >;
      customers: Table<
        Customer,
        Partial<Omit<Customer, "id" | "created_at" | "name">> &
          Pick<Customer, "name"> &
          Partial<Pick<Customer, "id">>
      >;
      stock_levels: Table<
        StockLevel,
        StockLevel,
        [
          {
            foreignKeyName: "stock_levels_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ]
      >;
      stock_adjustments: Table<
        StockAdjustment,
        Omit<StockAdjustment, "id" | "created_at" | "category" | "cost_impact"> &
          Partial<Pick<StockAdjustment, "id" | "category" | "cost_impact">>
      >;
      recipe_items: Table<
        RecipeItem,
        Omit<RecipeItem, "id" | "created_at"> & Partial<Pick<RecipeItem, "id">>,
        [
          {
            foreignKeyName: "recipe_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipe_items_ingredient_product_id_fkey";
            columns: ["ingredient_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ]
      >;
      order_item_ingredients: Table<
        OrderItemIngredient,
        Omit<OrderItemIngredient, "id" | "created_at"> & Partial<Pick<OrderItemIngredient, "id">>,
        [
          {
            foreignKeyName: "order_item_ingredients_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ]
      >;
      product_site_links: Table<
        ProductSiteLink,
        Omit<ProductSiteLink, "id" | "created_at"> & Partial<Pick<ProductSiteLink, "id">>,
        [
          {
            foreignKeyName: "product_site_links_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ]
      >;
      website_product_purchase_costs: Table<
        WebsiteProductPurchaseCost,
        Omit<
          WebsiteProductPurchaseCost,
          "id" | "updated_at" | "original_cost" | "total_cost_10pct" | "extra_money"
        > &
          Partial<
            Pick<
              WebsiteProductPurchaseCost,
              "id" | "updated_at" | "original_cost" | "total_cost_10pct" | "extra_money"
            >
          >
      >;
      sets: Table<
        ProductSet,
        Omit<ProductSet, "id" | "created_at" | "updated_at" | "status" | "suggested_sell_price"> &
          Partial<Pick<ProductSet, "id" | "created_at" | "updated_at" | "status" | "suggested_sell_price">>,
        [
          {
            foreignKeyName: "sets_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ]
      >;
      set_items: Table<
        SetItem,
        Omit<SetItem, "id" | "created_at" | "sort_order" | "unit_cost"> &
          Partial<Pick<SetItem, "id" | "created_at" | "sort_order" | "unit_cost">>,
        [
          {
            foreignKeyName: "set_items_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "set_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ]
      >;
      promotions: Table<
        Promotion,
        Omit<Promotion, "id" | "created_at"> & Partial<Pick<Promotion, "id">>
      >;
      orders: Table<
        Order,
        Omit<Order, "id" | "created_at"> & Partial<Pick<Order, "id">>,
        [
          {
            foreignKeyName: "orders_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ]
      >;
      order_items: Table<
        OrderItem,
        Omit<OrderItem, "id" | "unit_cost" | "cogs" | "cost_source"> &
          Partial<Pick<OrderItem, "id" | "unit_cost" | "cogs" | "cost_source">>,
        [
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ]
      >;
      expenses: Table<
        Expense,
        Omit<Expense, "id" | "created_at"> & Partial<Pick<Expense, "id" | "expense_date">>
      >;
      cash_reconciliations: Table<
        CashReconciliation,
        Omit<CashReconciliation, "id" | "created_at"> & Partial<Pick<CashReconciliation, "id">>
      >;
    };
    Views: Record<string, never>;
    Functions: {
      charge_order: {
        Args: {
          p_brand_id: string;
          p_customer_id: string | null;
          p_created_by: string | null;
          p_payment_method: PaymentMethod;
          p_payment_reference: string | null;
          p_items: Json;
          p_customer_name?: string | null;
          p_customer_phone?: string | null;
          p_discount?: number;
          p_delivery_fee?: number;
        };
        Returns: string;
      };
      adjust_stock: {
        Args: {
          p_product_id: string;
          p_delta: number;
          p_reason: string | null;
          p_created_by: string | null;
          p_category?: StockAdjustmentCategory;
        };
        Returns: number;
      };
      delete_order: {
        Args: {
          p_order_id: string;
        };
        Returns: string[];
      };
      set_order_fulfillment_status: {
        Args: {
          p_order_id: string;
          p_status: FulfillmentStatus;
        };
        Returns: string[];
      };
      create_online_order: {
        Args: {
          p_brand_id: string;
          p_site: string;
          p_site_order_id: string;
          p_items: Json;
          p_customer_name?: string | null;
          p_customer_phone?: string | null;
          p_customer_email?: string | null;
          p_subtotal?: number | null;
          p_discount?: number;
          p_delivery_fee?: number;
          p_total?: number | null;
          p_payment_method?: PaymentMethod | null;
          p_delivery_at?: string | null;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
