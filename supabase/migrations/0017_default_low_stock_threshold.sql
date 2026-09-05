-- "Low stock" was opt-in per product (threshold 0 = alerts off), and nothing
-- had ever been customized, so no product actually flagged as low. Make 1-5
-- units left the store-wide default: change the column default, backfill
-- every still-default (0) row, and update every place that creates a
-- stock_levels row with a hardcoded 0 so new products get the same default.

update stock_levels set low_stock_threshold = 5, updated_at = now() where low_stock_threshold = 0;

alter table stock_levels alter column low_stock_threshold set default 5;

create or replace function public.handle_new_product_stock()
returns trigger
language plpgsql
as $$
begin
  insert into stock_levels (product_id, quantity, low_stock_threshold)
  values (new.id, 0, 5)
  on conflict (product_id) do nothing;
  return new;
end;
$$;

-- Re-created from 0012 with the missing-row safety-net insert's threshold
-- bumped from 0 to 5 -- everything else is unchanged.
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

  return v_order_id;
end;
$$;

-- Re-created from 0015 with the missing-row safety-net insert's threshold
-- bumped from 0 to 5 -- everything else is unchanged.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta numeric,
  p_reason text,
  p_created_by uuid
)
returns numeric
language plpgsql
as $$
declare
  v_new_quantity numeric(12, 2);
begin
  if p_delta = 0 then
    raise exception 'Adjustment delta cannot be zero';
  end if;

  insert into stock_adjustments (product_id, delta, reason, created_by)
  values (p_product_id, p_delta, nullif(btrim(p_reason), ''), p_created_by);

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
