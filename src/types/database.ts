export type StaffRole = "admin" | "sales" | "stock" | "accountance" | "marketing";
export type PaymentMethod = "cash" | "bank_qr";
export type OrderStatus = "open" | "paid" | "voided";
export type DiscountType = "percent" | "fixed";

export type Brand = {
  id: string;
  slug: string;
  name: string;
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
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
};

export type StockLevel = {
  product_id: string;
  quantity: number;
  low_stock_threshold: number;
  updated_at: string;
};

export type StockAdjustment = {
  id: string;
  product_id: string;
  delta: number;
  reason: string;
  created_by: string | null;
  created_at: string;
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
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  created_by: string | null;
  created_at: string;
  paid_at: string | null;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type Table<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      brands: Table<Brand, Omit<Brand, "id" | "created_at"> & Partial<Pick<Brand, "id">>>;
      profiles: Table<Profile, Omit<Profile, "created_at">>;
      categories: Table<
        Category,
        Omit<Category, "id" | "created_at"> & Partial<Pick<Category, "id" | "sort_order">>
      >;
      products: Table<
        Product,
        Omit<Product, "id" | "created_at" | "updated_at"> & Partial<Pick<Product, "id">>
      >;
      customers: Table<
        Customer,
        Omit<Customer, "id" | "created_at"> & Partial<Pick<Customer, "id">>
      >;
      stock_levels: Table<StockLevel, StockLevel>;
      stock_adjustments: Table<
        StockAdjustment,
        Omit<StockAdjustment, "id" | "created_at"> & Partial<Pick<StockAdjustment, "id">>
      >;
      promotions: Table<
        Promotion,
        Omit<Promotion, "id" | "created_at"> & Partial<Pick<Promotion, "id">>
      >;
      orders: Table<Order, Omit<Order, "id" | "created_at"> & Partial<Pick<Order, "id">>>;
      order_items: Table<OrderItem, Omit<OrderItem, "id"> & Partial<Pick<OrderItem, "id">>>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
