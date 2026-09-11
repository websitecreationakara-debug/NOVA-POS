-- Adds an optional p_delivery_at param to create_online_order() so a website
-- order's customer-requested delivery/pickup time actually reaches POS's
-- orders.delivery_at column instead of that always staying null. Previously
-- a synced order's delivery time only ever existed on the storefront's own
-- side (orders.scheduled_at there), which is why POS and the website could
-- show different -- or, from POS's perspective, no -- delivery times for
-- the same order.
--
-- CREATE OR REPLACE with a different parameter list creates a new overload
-- rather than replacing the existing function, so the old (pre-delivery_at)
-- signature is dropped explicitly afterward -- otherwise calling the RPC
-- with named args that happen to satisfy both overloads' defaults raises
-- "function is not unique".

drop function if exists public.create_online_order(
  uuid, text, text, jsonb, text, text, text, numeric, numeric, numeric, numeric, payment_method
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
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order has no items';
  end if;

  select id into v_existing_id from orders where site = p_site and site_order_id = p_site_order_id;
  if v_existing_id is not null then
    return v_existing_id;
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
    p_brand_id, null, null, 'paid',
    v_subtotal, coalesce(p_discount, 0), 0, v_total, coalesce(p_delivery_fee, 0), p_payment_method, now(),
    'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
    nullif(btrim(p_customer_name), ''), nullif(btrim(p_customer_phone), ''), nullif(btrim(p_customer_email), ''),
    'online', p_site, p_site_order_id, p_delivery_at
  )
  returning id into v_order_id;

  insert into order_items (order_id, product_id, quantity, unit_price, line_total)
  select
    v_order_id,
    psl.product_id,
    (item ->> 'quantity')::numeric,
    (item ->> 'unitPrice')::numeric,
    (item ->> 'quantity')::numeric * (item ->> 'unitPrice')::numeric
  from jsonb_array_elements(p_items) as item
  join product_site_links psl on psl.site = p_site and psl.site_product_id = item ->> 'siteProductId';

  update stock_levels sl
  set quantity = sl.quantity - agg.total_qty, updated_at = now()
  from (
    select psl.product_id, sum((item ->> 'quantity')::numeric) as total_qty
    from jsonb_array_elements(p_items) as item
    join product_site_links psl on psl.site = p_site and psl.site_product_id = item ->> 'siteProductId'
    group by psl.product_id
  ) as agg
  where sl.product_id = agg.product_id;

  insert into stock_levels (product_id, quantity, low_stock_threshold)
  select agg.product_id, -agg.total_qty, 0
  from (
    select psl.product_id, sum((item ->> 'quantity')::numeric) as total_qty
    from jsonb_array_elements(p_items) as item
    join product_site_links psl on psl.site = p_site and psl.site_product_id = item ->> 'siteProductId'
    group by psl.product_id
  ) as agg
  where not exists (select 1 from stock_levels sl where sl.product_id = agg.product_id);

  return v_order_id;
end;
$function$;
