export type StaffRole = "admin" | "sales" | "stock" | "accountance" | "marketing";
export type PaymentMethod = "cash" | "bank_qr";
export type OrderStatus = "open" | "paid" | "voided";
export type DiscountType = "percent" | "fixed";

export interface Brand {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  role: StaffRole;
  created_at: string;
}

export interface Category {
  id: string;
  brand_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Product {
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
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
}

export interface StockLevel {
  product_id: string;
  quantity: number;
  low_stock_threshold: number;
  updated_at: string;
}

export interface StockAdjustment {
  id: string;
  product_id: string;
  delta: number;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export interface Promotion {
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
}

export interface Order {
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
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Database {
  public: {
    Tables: {
      brands: { Row: Brand; Insert: Partial<Brand>; Update: Partial<Brand> };
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      categories: { Row: Category; Insert: Partial<Category>; Update: Partial<Category> };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product> };
      customers: { Row: Customer; Insert: Partial<Customer>; Update: Partial<Customer> };
      stock_levels: { Row: StockLevel; Insert: Partial<StockLevel>; Update: Partial<StockLevel> };
      stock_adjustments: {
        Row: StockAdjustment;
        Insert: Partial<StockAdjustment>;
        Update: Partial<StockAdjustment>;
      };
      promotions: { Row: Promotion; Insert: Partial<Promotion>; Update: Partial<Promotion> };
      orders: { Row: Order; Insert: Partial<Order>; Update: Partial<Order> };
      order_items: { Row: OrderItem; Insert: Partial<OrderItem>; Update: Partial<OrderItem> };
    };
  };
}
