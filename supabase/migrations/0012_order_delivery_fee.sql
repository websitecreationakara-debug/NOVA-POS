-- Sales checkout gets a % discount, a flat "minus" deduction, and a
-- delivery fee. The two deduction types are folded into the existing
-- `discount` column as a single dollar amount (staff enters % and minus
-- separately, but nothing downstream needs to tell them apart once
-- charged) -- delivery is new since it adds to the total rather than
-- subtracting from it.

alter table orders add column delivery_fee numeric(12, 2) not null default 0;

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
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  select coalesce(sum((item ->> 'unitPrice')::numeric * (item ->> 'quantity')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(p_items) as item;

  -- Clamp so a fat-fingered discount can't push the charged total negative.
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

  -- Every product gets a stock_levels row at creation time (see the
  -- products_create_stock_level trigger from migration 0003), so the
  -- update below always matches an existing row in practice; the insert
  -- is only a safety net for any row that predates that trigger.
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
  select agg.product_id, -agg.total_qty, 0
  from (
    select (item ->> 'productId')::uuid as product_id,
           sum((item ->> 'quantity')::numeric) as total_qty
    from jsonb_array_elements(p_items) as item
    group by (item ->> 'productId')::uuid
  ) as agg
  where not exists (
    select 1 from stock_levels sl where sl.product_id = agg.product_id
  );

  return v_order_id;
end;
$$;

revoke execute on function public.charge_order(
  uuid, uuid, uuid, payment_method, text, jsonb, text, text, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.charge_order(
  uuid, uuid, uuid, payment_method, text, jsonb, text, text, numeric, numeric
) to service_role;

-- The old 8-arg overload is superseded, drop it so PostgREST doesn't have
-- to disambiguate two functions of the same name via arg count.
drop function if exists public.charge_order(
  uuid, uuid, uuid, payment_method, text, jsonb, text, text
);
