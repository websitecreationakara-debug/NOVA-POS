-- Three website-order data-integrity fixes from the 2026-09-30 QA run:
--
-- 1. Auto-created products (migration 0043's self-healing for an unlinked
--    site product) are now flagged products.auto_created so staff can review
--    them, and a sale of one no longer drives its stock negative: it started
--    at 0 and POS never had real stock for it. restock_order_items() skips the
--    same products so a cancel/delete doesn't hand back stock that was never
--    taken. The flag is cleared when staff rename the product (Stock page).
--
-- 2. create_online_order() now ignores the storefront's subtotal/total and
--    recomputes both from the items (a $50 order could be stored as $1).
--
-- 3. Price and quantity are rounded to the 2 decimals they're stored at
--    before line_total/subtotal are computed, so 3 x 0.335 no longer shows
--    unit 0.34 x 3 next to a line total of 1.01.

alter table public.products
  add column if not exists auto_created boolean not null default false;

create or replace function public.restock_order_items(
  p_order_id uuid,
  p_sign int,
  p_reason text
)
returns setof uuid
language plpgsql
as $$
declare
  v_rec record;
  v_cost_price numeric(12, 2);
begin
  for v_rec in
    select oi.product_id, sum(oi.quantity) as total_qty
    from order_items oi
    join products p on p.id = oi.product_id
    where oi.order_id = p_order_id
      -- create_online_order() never deducted stock for an auto-created,
      -- not-yet-reviewed product, so there is nothing to give back (or take
      -- again) -- doing so would invent stock out of thin air.
      and not p.auto_created
    group by oi.product_id
  loop
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    values (v_rec.product_id, p_sign * v_rec.total_qty, 5)
    on conflict (product_id) do update
      set quantity = stock_levels.quantity + p_sign * v_rec.total_qty, updated_at = now();

    select cost_price into v_cost_price from products where id = v_rec.product_id;
    insert into stock_adjustments (product_id, delta, reason, created_by, category, cost_impact, created_at)
    values (
      v_rec.product_id, p_sign * v_rec.total_qty, p_reason, null, 'other',
      case when p_sign < 0 and v_cost_price is not null then v_rec.total_qty * v_cost_price else null end,
      now()
    );

    return next v_rec.product_id;
  end loop;

  for v_rec in
    select oii.ingredient_product_id as product_id, sum(oii.quantity) as total_qty
    from order_item_ingredients oii
    join order_items oi on oi.id = oii.order_item_id
    where oi.order_id = p_order_id
    group by oii.ingredient_product_id
  loop
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    values (v_rec.product_id, p_sign * v_rec.total_qty, 5)
    on conflict (product_id) do update
      set quantity = stock_levels.quantity + p_sign * v_rec.total_qty, updated_at = now();

    select cost_price into v_cost_price from products where id = v_rec.product_id;
    insert into stock_adjustments (product_id, delta, reason, created_by, category, cost_impact, created_at)
    values (
      v_rec.product_id, p_sign * v_rec.total_qty, p_reason || ' (recipe ingredient)', null, 'other',
      case when p_sign < 0 and v_cost_price is not null then v_rec.total_qty * v_cost_price else null end,
      now()
    );

    return next v_rec.product_id;
  end loop;
end;
$$;

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

  -- subtotal/total are ALWAYS recomputed from the lines (p_subtotal and
  -- p_total are still accepted so existing callers keep working, but are
  -- ignored): trusting the caller let a $50 order be stored as $1. Price and
  -- quantity are rounded to 2 decimals first -- the same way they're stored --
  -- so each line's total, the subtotal, and the printed invoice rows always
  -- add up to the cent.
  select coalesce(sum(round(round((item ->> 'unitPrice')::numeric, 2) * round((item ->> 'quantity')::numeric, 2), 2)), 0)
  into v_subtotal
  from jsonb_array_elements(p_items) as item;
  v_total := greatest(v_subtotal - coalesce(p_discount, 0) + coalesce(p_delivery_fee, 0), 0);

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
    v_quantity := round((v_item ->> 'quantity')::numeric, 2);
    v_unit_price := round((v_item ->> 'unitPrice')::numeric, 2);
    v_title := nullif(btrim(v_item ->> 'title'), '');

    select product_id into v_product_id
    from product_site_links
    where site = p_site and site_product_id = v_site_product_id and variation_id = v_variation_id;

    if v_product_id is null then
      -- auto_created flags it for staff review (badge on Stock; cleared when
      -- they rename it). Its stock stays at 0 -- a sale of a product POS
      -- never had must not show up as a ghost negative quantity.
      insert into products (brand_id, category_id, name, sku, price, unit, image_url, is_active, auto_created)
      values (
        p_brand_id, null,
        coalesce(v_title, 'Website product ' || v_site_product_id),
        null, v_unit_price, 'pcs', null, true, true
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
      v_order_id, v_product_id, v_quantity, v_unit_price, round(v_quantity * v_unit_price, 2),
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
    where product_id = v_product_id
      and not exists (select 1 from products where id = v_product_id and auto_created);
  end loop;

  return v_order_id;
end;
$function$;
