-- create_online_order() used an inner join against product_site_links, so
-- any item whose (site, site_product_id, variation_id) had no matching link
-- silently vanished from the order -- the order still landed with its real
-- dollar total (subtotal/total come from the storefront, not the items), but
-- with fewer (sometimes zero) order_items than were actually purchased. That
-- required someone to notice the mismatch, dig up the real product, and
-- manually create the missing product_site_links row every single time.
--
-- Every item now always gets a line: an existing link is used as before,
-- but a line with no match auto-creates a new POS product (named from the
-- storefront's own item title when it sent one) and links it on the spot,
-- so the order is never missing anything and every later sale of that same
-- product matches normally from here on -- it self-heals instead of
-- silently dropping.

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
      -- No explicit stock_levels insert here: products_create_stock_level
      -- (migration 0003) already creates one right after the products insert
      -- above -- inserting again here would collide with it. The decrement
      -- below applies to that trigger-created row same as any other product.
    end if;

    insert into order_items (order_id, product_id, quantity, unit_price, line_total)
    values (v_order_id, v_product_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    update stock_levels
    set quantity = quantity - v_quantity, updated_at = now()
    where product_id = v_product_id;
  end loop;

  return v_order_id;
end;
$function$;
