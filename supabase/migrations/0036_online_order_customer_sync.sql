-- Online orders synced from a storefront (create_online_order, called from
-- /api/order-sync) always left customer_id null and only wrote
-- customer_name/customer_phone as free text onto the order -- unlike a
-- POS-charged sale (chargeOrder -> getOrCreateCustomerId), which always
-- finds-or-creates a real `customers` row first. That's why Sales' phone/name
-- search (which only queries `customers`) came up empty for a phone number
-- that's plainly visible on the Orders page: the order had it, `customers`
-- never did.
--
-- Fixes it going forward (create_online_order now finds-or-creates a
-- customers row by phone, same as the POS path) and backfills every existing
-- order that's missing one.

-- CREATE OR REPLACE with the same parameter list as 0022 just replaces it in
-- place -- no signature change, so no drop-old-overload step needed here.
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
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Order has no items';
  end if;

  select id into v_existing_id from orders where site = p_site and site_order_id = p_site_order_id;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- Same identity key as the POS checkout (chargeOrder/getOrCreateCustomerId):
  -- one phone number resolves to exactly one customer record (unique index
  -- customers_phone_key, migration 0011). Reuses an existing customer as-is
  -- (never overwrites their name off a possibly-stale order snapshot) --
  -- only a brand-new phone gets a brand-new row, named from this order (or
  -- from the phone itself, since customers.name is not-null and a storefront
  -- guest checkout doesn't always collect a name). No phone on the order ->
  -- no customer row, same as before (nothing to search by anyway).
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

-- Backfill: every already-synced online order that's missing a customer_id
-- gets one, reusing a matching customers row by phone if one already exists
-- (e.g. from a POS sale) or creating one from the earliest such order for
-- that phone. Safe to rerun -- both steps only ever touch rows that are
-- still missing what they need.
insert into customers (name, phone)
select distinct on (o.customer_phone)
  coalesce(nullif(btrim(o.customer_name), ''), o.customer_phone),
  o.customer_phone
from orders o
where o.customer_id is null
  and o.customer_phone is not null
  and btrim(o.customer_phone) <> ''
  and not exists (select 1 from customers c where c.phone = o.customer_phone)
order by o.customer_phone, o.created_at asc
on conflict (phone) where phone is not null do nothing;

update orders o
set customer_id = c.id
from customers c
where o.customer_id is null
  and o.customer_phone is not null
  and btrim(o.customer_phone) <> ''
  and c.phone = o.customer_phone;
