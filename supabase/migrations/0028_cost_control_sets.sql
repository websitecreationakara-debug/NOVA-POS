-- Marketing > Cost Control: bundle multiple existing Stock products into a
-- "Set" (e.g. a gift box/combo) costed and priced as one thing. Line items
-- reference `products` directly -- never a separate re-entered product record
-- -- so a set's cost stays tied to the same catalog Stock manages.
create table sets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  -- User-assigned short code (e.g. "A1") -- unique per brand, not globally.
  code text not null,
  name text not null,
  suggested_sell_price numeric(12, 2),
  status text not null default 'draft' check (status in ('draft', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, code)
);

comment on table sets is
  'A bundle of existing products (Marketing > Cost Control). Total Cost and Margin % are computed from set_items + suggested_sell_price, not stored -- see costControl.ts.';

create table set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  -- Supports fractional amounts (e.g. 0.5 kg of an ingredient in the set).
  amount numeric(12, 4) not null check (amount > 0),
  -- Snapshot of the product's unit/cost at the time it was added (or last
  -- refreshed) -- editable independently so a later catalog change doesn't
  -- silently reprice an already-built set out from under it.
  unit text not null,
  unit_cost numeric(12, 2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (set_id, product_id)
);

create index set_items_set_id_idx on set_items (set_id);

comment on table set_items is
  'One line item (an existing product + amount used) inside a Set. Line Total = amount * unit_cost, computed in the app, not stored.';

alter table public.sets enable row level security;
alter table public.set_items enable row level security;
