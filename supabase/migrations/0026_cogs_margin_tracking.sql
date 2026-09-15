-- COGS & Margin Tracking
--
-- Adds: a per-product cost price, optional recipes (a sold product built
-- from other products-as-ingredients, e.g. a latte consuming milk + a cup),
-- a cost snapshot on every order line (so a later cost-price change never
-- rewrites history), and a categorized reason on manual stock adjustments
-- (waste / promotion / other) with its own cost impact -- everything the
-- Accountance "COGS & Margin Tracking" tab and Profit & Loss report need.
--
-- Ingredients are just ordinary `products` rows (own stock_levels, own
-- cost_price) flagged `is_ingredient` so the Sales grid can hide them --
-- reuses the existing stock/cost machinery instead of a parallel system.

alter table products
  add column cost_price numeric(12, 2) check (cost_price is null or cost_price >= 0),
  add column is_ingredient boolean not null default false;

-- A recipe: product_id (the sold item) is built from `quantity` units of
-- ingredient_product_id (also a `products` row) per 1 unit sold. A product
-- with no rows here just uses its own cost_price directly.
create table recipe_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  ingredient_product_id uuid not null references products (id) on delete restrict,
  quantity numeric(12, 4) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (product_id, ingredient_product_id),
  check (product_id <> ingredient_product_id)
);

create index recipe_items_product_id_idx on recipe_items (product_id);

-- unit_cost/cogs are a snapshot of what the sale actually cost *at the time
-- it happened* -- read back later for margin reporting, never recomputed
-- live from the product's current cost_price, so editing a cost price today
-- can't rewrite last month's numbers. Both null (not 0) when the cost was
-- unknown at sale time, so reporting can tell "no cost recorded" apart from
-- "cost was zero".
alter table order_items
  add column unit_cost numeric(12, 2),
  add column cogs numeric(12, 2),
  add column cost_source text check (cost_source in ('direct', 'recipe'));

-- Snapshot of exactly which ingredients (and how much of each) a recipe-based
-- order line consumed -- lets delete/cancel restore ingredient stock
-- precisely later even if the recipe itself has since changed.
create table order_item_ingredients (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items (id) on delete cascade,
  ingredient_product_id uuid not null references products (id),
  quantity numeric(12, 4) not null,
  unit_cost numeric(12, 2),
  created_at timestamptz not null default now()
);

create index order_item_ingredients_order_item_id_idx on order_item_ingredients (order_item_id);

-- Categorizes manual stock adjustments (waste/spillage, complimentary or
-- promotional giveaways, or anything else) and snapshots the cost of stock
-- that left the shelf uncompensated -- what the COGS tab's Waste/Promotion
-- cards and the P&L's Net Profit sum up. Existing rows default to 'other'
-- with no cost impact rather than guessing at their intent.
alter table stock_adjustments
  add column category text not null default 'other' check (category in ('waste', 'promotion', 'other')),
  add column cost_impact numeric(12, 2);

alter table public.recipe_items enable row level security;
alter table public.order_item_ingredients enable row level security;

-- ------------------------------------------------------------------
-- charge_order(): same signature/order-insert/stock-decrement logic as
-- 0017_default_low_stock_threshold.sql, with a COGS pass appended -- for
-- each line just inserted, price it either from the product's own
-- cost_price ("direct") or, if it has a recipe, from summing the recipe's
-- ingredient costs ("recipe"), deducting ingredient stock and recording
-- exactly what was consumed as it goes. Still one function call = one
-- transaction, so an order, its stock deduction, and its COGS can't drift
-- apart from each other.
-- ------------------------------------------------------------------
create or replace function public.charge_order(
  p_brand_id uuid,
  p_customer_id uuid,
  p_created_by uuid,
  p_payment_method payment_method,
  p_payment_reference text,
  p_items jsonb,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_discount numeric default 0,
  p_delivery_fee numeric default 0
)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid;
  v_subtotal numeric(12, 2);
  v_total numeric(12, 2);
  v_item record;
  v_has_recipe boolean;
  v_unit_cost numeric(12, 2);
  v_cost_source text;
  v_ingredient record;
  v_consumed numeric(12, 4);
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  select coalesce(sum((item ->> 'unitPrice')::numeric * (item ->> 'quantity')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_items) as item;

  v_total := greatest(v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0), 0);

  insert into orders (
    brand_id, customer_id, created_by, status,
    subtotal, discount, tax, total, delivery_fee, payment_method, payment_reference, paid_at,
    invoice_number, customer_name, customer_phone
  )
  values (
    p_brand_id, p_customer_id, p_created_by, 'paid',
    v_subtotal, coalesce(p_discount, 0), 0, v_total, coalesce(p_delivery_fee, 0),
    p_payment_method, p_payment_reference, now(),
    'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
    nullif(btrim(p_customer_name), ''), nullif(btrim(p_customer_phone), '')
  )
  returning id into v_order_id;

  insert into order_items (order_id, product_id, quantity, unit_price, line_total)
  select
    v_order_id,
    (item ->> 'productId')::uuid,
    (item ->> 'quantity')::numeric,
    (item ->> 'unitPrice')::numeric,
    (item ->> 'quantity')::numeric * (item ->> 'unitPrice')::numeric
  from jsonb_array_elements(p_items) as item;

  update stock_levels sl
  set quantity = sl.quantity - agg.total_qty, updated_at = now()
  from (
    select (item ->> 'productId')::uuid as product_id,
           sum((item ->> 'quantity')::numeric) as total_qty
    from jsonb_array_elements(p_items) as item
    group by (item ->> 'productId')::uuid
  ) as agg
  where sl.product_id = agg.product_id;

  insert into stock_levels (product_id, quantity, low_stock_threshold)
  select agg.product_id, -agg.total_qty, 5
  from (
    select (item ->> 'productId')::uuid as product_id,
           sum((item ->> 'quantity')::numeric) as total_qty
    from jsonb_array_elements(p_items) as item
    group by (item ->> 'productId')::uuid
  ) as agg
  where not exists (
    select 1 from stock_levels sl where sl.product_id = agg.product_id
  );

  -- COGS pass: price each line just inserted, direct or recipe-based, and
  -- for a recipe also deduct/record the ingredients it consumed.
  for v_item in select id, product_id, quantity from order_items where order_id = v_order_id loop
    select exists(select 1 from recipe_items where product_id = v_item.product_id) into v_has_recipe;

    if v_has_recipe then
      v_cost_source := 'recipe';
      select case when bool_or(p2.cost_price is null) then null
                  else sum(ri.quantity * p2.cost_price) end
      into v_unit_cost
      from recipe_items ri
      join products p2 on p2.id = ri.ingredient_product_id
      where ri.product_id = v_item.product_id;

      for v_ingredient in
        select ri.ingredient_product_id, ri.quantity, p2.cost_price
        from recipe_items ri
        join products p2 on p2.id = ri.ingredient_product_id
        where ri.product_id = v_item.product_id
      loop
        v_consumed := v_ingredient.quantity * v_item.quantity;

        update stock_levels
        set quantity = quantity - v_consumed, updated_at = now()
        where product_id = v_ingredient.ingredient_product_id;

        if not found then
          insert into stock_levels (product_id, quantity, low_stock_threshold)
          values (v_ingredient.ingredient_product_id, -v_consumed, 5);
        end if;

        insert into order_item_ingredients (order_item_id, ingredient_product_id, quantity, unit_cost)
        values (v_item.id, v_ingredient.ingredient_product_id, v_consumed, v_ingredient.cost_price);
      end loop;
    else
      v_cost_source := 'direct';
      select cost_price into v_unit_cost from products where id = v_item.product_id;
    end if;

    update order_items
    set unit_cost = v_unit_cost,
        cogs = case when v_unit_cost is null then null else v_unit_cost * v_item.quantity end,
        cost_source = v_cost_source
    where id = v_item.id;
  end loop;

  return v_order_id;
end;
$$;

-- ------------------------------------------------------------------
-- delete_order(): unchanged product-stock restore from
-- 0016_add_delete_order_function.sql, with a second pass restoring any
-- ingredient stock a recipe-based line consumed (from the
-- order_item_ingredients snapshot, so it's exact even if the recipe has
-- since changed).
-- ------------------------------------------------------------------
create or replace function public.delete_order(p_order_id uuid)
returns setof uuid
language plpgsql
as $$
declare
  v_product_id uuid;
begin
  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + oi.quantity, updated_at = now()
    from order_items oi
    where oi.order_id = p_order_id and oi.product_id = s.product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;

  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + agg.total_qty, updated_at = now()
    from (
      select oii.ingredient_product_id, sum(oii.quantity) as total_qty
      from order_item_ingredients oii
      join order_items oi on oi.id = oii.order_item_id
      where oi.order_id = p_order_id
      group by oii.ingredient_product_id
    ) as agg
    where s.product_id = agg.ingredient_product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;

  delete from order_items where order_id = p_order_id;
  delete from orders where id = p_order_id;
end;
$$;

-- ------------------------------------------------------------------
-- set_order_fulfillment_status(): same cancelled/not-cancelled product-stock
-- symmetry as 0025_fulfillment_status_stock_symmetry.sql, with the same
-- ingredient-stock symmetry added alongside it.
-- ------------------------------------------------------------------
create or replace function public.set_order_fulfillment_status(
  p_order_id uuid,
  p_status fulfillment_status
)
returns setof uuid
language plpgsql
as $$
declare
  v_product_id uuid;
  v_was_cancelled boolean;
  v_now_cancelled boolean := (p_status = 'cancelled');
begin
  select fulfillment_status = 'cancelled' into v_was_cancelled
  from orders
  where id = p_order_id;

  if v_was_cancelled is null then
    return;
  end if;

  update orders set fulfillment_status = p_status where id = p_order_id;

  if v_was_cancelled = v_now_cancelled then
    return;
  end if;

  if v_now_cancelled then
    for v_product_id in
      update stock_levels s
      set quantity = s.quantity + oi.quantity, updated_at = now()
      from order_items oi
      where oi.order_id = p_order_id and oi.product_id = s.product_id
      returning s.product_id
    loop
      return next v_product_id;
    end loop;

    for v_product_id in
      update stock_levels s
      set quantity = s.quantity + agg.total_qty, updated_at = now()
      from (
        select oii.ingredient_product_id, sum(oii.quantity) as total_qty
        from order_item_ingredients oii
        join order_items oi on oi.id = oii.order_item_id
        where oi.order_id = p_order_id
        group by oii.ingredient_product_id
      ) as agg
      where s.product_id = agg.ingredient_product_id
      returning s.product_id
    loop
      return next v_product_id;
    end loop;
  else
    for v_product_id in
      update stock_levels s
      set quantity = s.quantity - oi.quantity, updated_at = now()
      from order_items oi
      where oi.order_id = p_order_id and oi.product_id = s.product_id
      returning s.product_id
    loop
      return next v_product_id;
    end loop;

    for v_product_id in
      update stock_levels s
      set quantity = s.quantity - agg.total_qty, updated_at = now()
      from (
        select oii.ingredient_product_id, sum(oii.quantity) as total_qty
        from order_item_ingredients oii
        join order_items oi on oi.id = oii.order_item_id
        where oi.order_id = p_order_id
        group by oii.ingredient_product_id
      ) as agg
      where s.product_id = agg.ingredient_product_id
      returning s.product_id
    loop
      return next v_product_id;
    end loop;
  end if;
end;
$$;

-- ------------------------------------------------------------------
-- adjust_stock(): gains p_category (waste/promotion/other, default
-- 'other') and snapshots cost_impact from the product's current cost_price.
-- A new parameter changes the function's signature, so the old 4-arg
-- overload is dropped explicitly (same pattern as
-- 0022_create_online_order_delivery_at.sql) rather than left callable
-- alongside the new one.
-- ------------------------------------------------------------------
drop function if exists public.adjust_stock(uuid, numeric, text, uuid);

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta numeric,
  p_reason text,
  p_created_by uuid,
  p_category text default 'other'
)
returns numeric
language plpgsql
as $$
declare
  v_new_quantity numeric(12, 2);
  v_category text;
  v_cost_price numeric(12, 2);
  v_cost_impact numeric(12, 2);
begin
  if p_delta = 0 then
    raise exception 'Adjustment delta cannot be zero';
  end if;

  v_category := case when p_category in ('waste', 'promotion', 'other') then p_category else 'other' end;

  select cost_price into v_cost_price from products where id = p_product_id;
  v_cost_impact := case when p_delta < 0 and v_cost_price is not null then -p_delta * v_cost_price else null end;

  insert into stock_adjustments (product_id, delta, reason, created_by, category, cost_impact)
  values (p_product_id, p_delta, nullif(btrim(p_reason), ''), p_created_by, v_category, v_cost_impact);

  update stock_levels
  set quantity = quantity + p_delta, updated_at = now()
  where product_id = p_product_id
  returning quantity into v_new_quantity;

  if not found then
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    values (p_product_id, p_delta, 5)
    returning quantity into v_new_quantity;
  end if;

  return v_new_quantity;
end;
$$;

revoke execute on function public.adjust_stock(uuid, numeric, text, uuid, text) from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text, uuid, text) to service_role;
