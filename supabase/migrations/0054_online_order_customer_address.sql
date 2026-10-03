-- Website orders now carry the customer's delivery address into POS. The
-- invoice reads customers.address, but create_online_order() never received
-- one, so every website invoice printed "..." in the address box.
--
-- p_customer_address is saved on the customer only when they have no address
-- yet, so a repeat order never overwrites an address staff corrected in POS.
--
-- Adding a parameter creates a new overload, so the previous (0046)
-- signature is dropped explicitly -- same reason as 0022.

drop function if exists public.create_online_order(
  uuid, text, text, jsonb, text, text, text, numeric, numeric, numeric, numeric, payment_method, timestamptz
);

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
  p_delivery_at timestamptz default null,
  p_customer_address text default null
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
  v_customer_address text := nullif(btrim(p_customer_address), '');
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

    if v_customer_address is not null then
      update customers
      set address = v_customer_address
      where id = v_customer_id and nullif(btrim(address), '') is null;
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
