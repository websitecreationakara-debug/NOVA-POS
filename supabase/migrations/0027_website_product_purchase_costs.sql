-- Per-storefront-item purchase cost tracking (Stock > Website product table's
-- Original Cost / Total Cost 10% / Extra Money columns) -- what POS staff
-- actually paid to acquire the stock, entirely separate from `products.price`
-- (what the storefront charges customers) and from `products.cost_price`
-- (used by the COGS & Margin Tracking report). Keyed by the storefront item
-- directly (site, site_product_id, variation_id), the same way
-- product_site_links is, so a cost can be recorded before -- or without ever
-- needing -- a linked POS product.
create table website_product_purchase_costs (
  id uuid primary key default gen_random_uuid(),
  site text not null check (site in ('bosba-premium-foods', 'bosba-drink-snack', 'sora-sake')),
  site_product_id text not null,
  -- Empty string for a simple (non-variable) site product; a variation's own
  -- id for one size/flavor of a "variable" product -- mirrors
  -- product_site_links.variation_id.
  variation_id text not null default '',
  original_cost numeric(12, 2),
  total_cost_10pct numeric(12, 2),
  extra_money numeric(12, 2),
  updated_at timestamptz not null default now(),
  unique (site, site_product_id, variation_id)
);

comment on table website_product_purchase_costs is
  'Manually-entered purchase-cost breakdown per storefront item (Stock > Website product table). Purchase Cost and Total are derived in the app, not stored: Purchase Cost = (original_cost + total_cost_10pct) / 2, Total = Purchase Cost + extra_money.';

alter table public.website_product_purchase_costs enable row level security;
