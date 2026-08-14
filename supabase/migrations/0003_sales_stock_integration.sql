-- Phase 2: sales -> stock integration.
--
-- Every product now gets a tracked stock_levels row: backfilled below for the
-- 12 existing products (at quantity 0, since no real counts have ever been
-- entered), and auto-created for any future product via trigger. Checkout
-- decrements stock atomically through charge_order(), but deliberately does
-- NOT block a sale when stock is insufficient -- with everything starting at
-- 0, blocking now would disable the Sales screen entirely. Revisit once
-- Phase 3's Stock page lets staff set real counts.

insert into stock_levels (product_id, quantity, low_stock_threshold)
select id, 0, 0 from products
on conflict (product_id) do nothing;

create or replace function public.handle_new_product_stock()
returns trigger
language plpgsql
as $$
begin
  insert into stock_levels (product_id, quantity, low_stock_threshold)
  values (new.id, 0, 0)
  on conflict (product_id) do nothing;
  return new;
end;
$$;

create trigger products_create_stock_level
  after insert on products
  for each row
  execute function public.handle_new_product_stock();

-- Runs the whole charge as one transaction (order + items + stock decrement)
-- so a failure partway through rolls back cleanly instead of needing the
-- best-effort delete-the-order cleanup Phase 1's chargeOrder() used to do.
-- The plain UPDATE on stock_levels takes a row lock itself, so concurrent
-- sales of the same product can't race and lose a decrement.
create or replace function public.charge_order(
  p_brand_id uuid,
  p_customer_id uuid,
  p_created_by uuid,
  p_payment_method payment_method,
  p_payment_reference text,
  p_items jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_order_id uuid;
  v_subtotal numeric(12, 2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(12, 2);
  v_unit_price numeric(12, 2);
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_subtotal := v_subtotal + (v_item ->> 'unitPrice')::numeric * (v_item ->> 'quantity')::numeric;
  end loop;

  insert into orders (
    brand_id, customer_id, created_by, status,
    subtotal, discount, tax, total, payment_method, payment_reference, paid_at
  )
  values (
    p_brand_id, p_customer_id, p_created_by, 'paid',
    v_subtotal, 0, 0, v_subtotal, p_payment_method, p_payment_reference, now()
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item ->> 'productId')::uuid;
    v_quantity := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unitPrice')::numeric;

    insert into order_items (order_id, product_id, quantity, unit_price, line_total)
    values (v_order_id, v_product_id, v_quantity, v_unit_price, v_quantity * v_unit_price);

    update stock_levels
    set quantity = quantity - v_quantity, updated_at = now()
    where product_id = v_product_id;

    if not found then
      insert into stock_levels (product_id, quantity, low_stock_threshold)
      values (v_product_id, -v_quantity, 0);
    end if;
  end loop;

  return v_order_id;
end;
$$;

revoke execute on function public.charge_order(uuid, uuid, uuid, payment_method, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.charge_order(uuid, uuid, uuid, payment_method, text, jsonb)
  to service_role;
