-- A storefront order sent several times at the same instant (double-click,
-- retry storm) created one POS order per copy AND deducted stock once per copy:
-- create_online_order() dedupes with a plain SELECT-then-INSERT, which is racy,
-- and nothing in the schema stopped the duplicates either (QA run 2026-09-30:
-- 15/15 rounds of 8 parallel identical POSTs produced duplicate orders).
--
-- Two layers, both needed:
--   1. an advisory lock inside create_online_order() so concurrent duplicates
--      queue up and the later ones return the first order, and
--   2. a unique index on (site, site_order_id) as the database-level backstop.
--
-- The orders.channel / site / site_order_id / customer_email columns were
-- added to the hosted database by hand (no earlier migration creates them), so
-- they're added here with IF NOT EXISTS -- a no-op where they already exist,
-- and it lets this migration run on a database rebuilt from these files.

alter table public.orders
  add column if not exists channel text not null default 'pos',
  add column if not exists site text,
  add column if not exists site_order_id text,
  add column if not exists customer_email text;

-- Building the index fails if the same (site, site_order_id) is already on
-- more than one order. Deleting orders automatically would be unsafe (they may
-- have been invoiced / had stock moved), so stop with a clear message instead.
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes from (
    select 1 from public.orders
    where site_order_id is not null
    group by site, site_order_id
    having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception
      'Cannot add unique index: % storefront order(s) already exist more than once in orders. Review and delete the extra copies (e.g. with delete_order()) first: select site, site_order_id, count(*) from orders where site_order_id is not null group by 1, 2 having count(*) > 1;',
      v_dupes;
  end if;
end $$;

-- Skipped when an equivalent unique index already exists (the hosted database
-- has one, orders_site_order_id_unique, made by hand) -- a second copy would
-- only slow every insert down.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'orders'
      and indexdef ilike 'create unique index%(site, site_order_id)%'
  ) then
    create unique index orders_site_site_order_id_key
      on public.orders (site, site_order_id)
      where site_order_id is not null;
  end if;
end $$;

create or replace function public.create_online_order(
  p_brand_id uuid,
  p_site text,
  p_site_order_id text,
  p_items jsonb,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_subtotal numeric default null,
  p_discount numeric default 0,
  p_delivery_fee numeric default 0,
  p_total numeric default null,
  p_payment_method payment_method default null,
  p_delivery_at timestamptz default null
)
returns uuid
language plpgsql
as $function$
declare
  v_order_id uuid;
  v_existing_id uuid;
  v_subtotal numeric(12, 2);
  v_total numeric(12, 2);
  v_customer_id uuid;
  v_customer_name text := nullif(btrim(p_customer_name), '');
  v_customer_phone text := nullif(btrim(p_customer_phone), '');
  v_item jsonb;
  v_site_product_id text;
  v_variation_id text;
  v_quantity numeric;
  v_unit_price numeric;
  v_title text;
  v_product_id uuid;
  v_order_item_id uuid;
  v_has_recipe boolean;
  v_unit_cost numeric(12, 2);
  v_cost_source text;
  v_ingredient record;
  v_consumed numeric(12, 4);
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order has no items';
  end if;

  -- Serialise concurrent submissions of the SAME storefront order: the SELECT
  -- below is check-then-insert, so without this lock N simultaneous retries all
  -- see "no existing order" and each insert their own copy (and each deduct
  -- stock). The lock is per (site, site_order_id), released at commit, so
  -- different orders never wait on each other and the losers of a race then
  -- find the winner's committed row and return it -- no error, no invoice-
  -- number gap.
  perform pg_advisory_xact_lock(hashtextextended(p_site || ':' || p_site_order_id, 0));

  select id into v_existing_id from orders where site = p_site and site_order_id = p_site_order_id;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  if v_customer_phone is not null then
    select id into v_customer_id from customers where phone = v_customer_phone;
    if v_customer_id is null then
      insert into customers (name, phone)
      values (coalesce(v_customer_name, v_customer_phone), v_customer_phone)
      on conflict (phone) where phone is not null do update set phone = excluded.phone
      returning id into v_customer_id;
    end if;
  end if;

  select coalesce(sum((item ->> 'unitPrice')::numeric * (item ->> 'quantity')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_items) as item;
  v_subtotal := coalesce(p_subtotal, v_subtotal);
  v_total := coalesce(p_total, greatest(v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0), 0));

  insert into orders (
    brand_id, customer_id, created_by, status,
    subtotal, discount, tax, total, delivery_fee, payment_method, paid_at,
    invoice_number, customer_name, customer_phone, customer_email,
    channel, site, site_order_id, delivery_at
  )
  values (
    p_brand_id, v_customer_id, null, 'paid',
    v_subtotal, coalesce(p_discount, 0), 0, v_total, coalesce(p_delivery_fee, 0), p_payment_method, now(),
    'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
    v_customer_name, v_customer_phone, nullif(btrim(p_customer_email), ''),
    'online', p_site, p_site_order_id, p_delivery_at
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_site_product_id := v_item ->> 'siteProductId';
    v_variation_id := coalesce(v_item ->> 'variationId', '');
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unitPrice')::numeric;
    v_title := nullif(btrim(v_item ->> 'title'), '');

    select product_id into v_product_id
    from product_site_links
    where site = p_site and site_product_id = v_site_product_id and variation_id = v_variation_id;

    if v_product_id is null then
      insert into products (brand_id, category_id, name, sku, price, unit, image_url, is_active)
      values (
        p_brand_id, null,
        coalesce(v_title, 'Website product ' || v_site_product_id),
        null, v_unit_price, 'pcs', null, true
      )
      returning id into v_product_id;

      insert into product_site_links (product_id, site, site_product_id, variation_id, matched_name, match_confidence)
      values (
        v_product_id, p_site, v_site_product_id, v_variation_id,
        coalesce(v_title, 'Website product ' || v_site_product_id),
        case when v_title is not null then 'exact' else 'loose' end
      );
    end if;

    -- Same COGS pricing as charge_order(): recipe-based sums its ingredient
    -- costs (and deducts/records what was consumed), everything else uses
    -- effective_product_cost() -- the website Purchase Cost Total when one's
    -- entered for this product, otherwise its plain cost_price.
    select exists(select 1 from recipe_items where product_id = v_product_id) into v_has_recipe;
    if v_has_recipe then
      v_cost_source := 'recipe';
      select case when bool_or(p2.cost_price is null) then null
                  else sum(ri.quantity * p2.cost_price) end
      into v_unit_cost
      from recipe_items ri
      join products p2 on p2.id = ri.ingredient_product_id
      where ri.product_id = v_product_id;
    else
      v_cost_source := 'direct';
      v_unit_cost := effective_product_cost(v_product_id);
    end if;

    insert into order_items (order_id, product_id, quantity, unit_price, line_total, unit_cost, cogs, cost_source)
    values (
      v_order_id, v_product_id, v_quantity, v_unit_price, v_quantity * v_unit_price,
      v_unit_cost,
      case when v_unit_cost is null then null else v_unit_cost * v_quantity end,
      v_cost_source
    )
    returning id into v_order_item_id;

    if v_has_recipe then
      for v_ingredient in
        select ri.ingredient_product_id, ri.quantity, p2.cost_price
        from recipe_items ri
        join products p2 on p2.id = ri.ingredient_product_id
        where ri.product_id = v_product_id
      loop
        v_consumed := v_ingredient.quantity * v_quantity;

        update stock_levels
        set quantity = quantity - v_consumed, updated_at = now()
        where product_id = v_ingredient.ingredient_product_id;

        if not found then
          insert into stock_levels (product_id, quantity, low_stock_threshold)
          values (v_ingredient.ingredient_product_id, -v_consumed, 5);
        end if;

        insert into order_item_ingredients (order_item_id, ingredient_product_id, quantity, unit_cost)
        values (v_order_item_id, v_ingredient.ingredient_product_id, v_consumed, v_ingredient.cost_price);
      end loop;
    end if;

    update stock_levels
    set quantity = quantity - v_quantity, updated_at = now()
    where product_id = v_product_id;
  end loop;

  return v_order_id;
end;
$function$;
