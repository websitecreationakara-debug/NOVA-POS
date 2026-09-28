-- Sale-time COGS capture (charge_order's direct-cost branch, and
-- create_online_order which never captured a cost at all) only ever read
-- products.cost_price -- never the richer Purchase Cost Total a staff member
-- may have already entered on Stock > Website (website_product_purchase_costs,
-- migration 0027/0032). So a website-linked product priced only through that
-- Stock page column sold with unit_cost/cogs permanently null, showing "No
-- cost price" in the Margin Report even though the cost was right there.
--
-- effective_product_cost() mirrors getEffectiveProductCost() (the same
-- lookup already used for Waste/Promotion valuation and Cost Control): the
-- website listing's Purchase Cost Total when the product is linked to one
-- and that Total is fully entered, otherwise the product's own cost_price.
-- Wired into both charge_order() (POS checkout) and create_online_order()
-- (website orders, which now also gets a full COGS pass it never had).

create or replace function public.effective_product_cost(p_product_id uuid)
returns numeric
language plpgsql
as $$
declare
  v_cost_price numeric(12, 2);
  v_link record;
  v_cost_row record;
  v_purchase_cost numeric(12, 2);
  v_total numeric(12, 2);
begin
  select cost_price into v_cost_price from products where id = p_product_id;

  select site, site_product_id, variation_id into v_link
  from product_site_links
  where product_id = p_product_id
  limit 1;

  if v_link is null then
    return v_cost_price;
  end if;

  select original_cost, total_cost_10pct, extra_money, total_override into v_cost_row
  from website_product_purchase_costs
  where site = v_link.site
    and site_product_id = v_link.site_product_id
    and variation_id = v_link.variation_id;

  if v_cost_row is null then
    return v_cost_price;
  end if;

  if v_cost_row.original_cost is null or v_cost_row.total_cost_10pct is null then
    v_purchase_cost := null;
  else
    v_purchase_cost := round((v_cost_row.original_cost + v_cost_row.total_cost_10pct) / 2, 2);
  end if;

  if v_purchase_cost is null then
    v_total := null;
  elsif v_cost_row.extra_money is null then
    v_total := v_purchase_cost;
  else
    v_total := round(v_purchase_cost + v_cost_row.extra_money, 2);
  end if;

  v_total := coalesce(v_cost_row.total_override, v_total);

  return coalesce(v_total, v_cost_price);
end;
$$;

revoke execute on function public.effective_product_cost(uuid) from public, anon, authenticated;
grant execute on function public.effective_product_cost(uuid) to service_role;

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
  -- for a recipe also deduct/record the ingredients it consumed. The direct
  -- branch now checks the website Purchase Cost Total first (see
  -- effective_product_cost), not just products.cost_price.
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
      v_unit_cost := effective_product_cost(v_item.product_id);
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
