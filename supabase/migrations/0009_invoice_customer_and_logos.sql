-- Invoice redesign: per-brand logo, and optional walk-in customer
-- name/phone captured at checkout (denormalized on orders rather than
-- requiring a full customers record -- most POS sales are anonymous).

alter table brands add column logo_url text;

update brands set logo_url = '/logos/bosba-premium-foods.png' where slug = 'bosba-premium-foods';
update brands set logo_url = '/logos/bosba-drink-snack.png' where slug = 'bosba-drink-snack';
update brands set logo_url = '/logos/sora-sake.png' where slug = 'sora-sake';

alter table orders add column customer_name text;
alter table orders add column customer_phone text;

create or replace function public.charge_order(
  p_brand_id uuid,
  p_customer_id uuid,
  p_created_by uuid,
  p_payment_method payment_method,
  p_payment_reference text,
  p_items jsonb,
  p_customer_name text default null,
  p_customer_phone text default null
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
    subtotal, discount, tax, total, payment_method, payment_reference, paid_at,
    invoice_number, customer_name, customer_phone
  )
  values (
    p_brand_id, p_customer_id, p_created_by, 'paid',
    v_subtotal, 0, 0, v_subtotal, p_payment_method, p_payment_reference, now(),
    'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
    nullif(btrim(p_customer_name), ''), nullif(btrim(p_customer_phone), '')
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

revoke execute on function public.charge_order(uuid, uuid, uuid, payment_method, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.charge_order(uuid, uuid, uuid, payment_method, text, jsonb, text, text)
  to service_role;

-- The old 6-arg overload is superseded, drop it so PostgREST doesn't have
-- to disambiguate two functions of the same name via arg count.
drop function if exists public.charge_order(uuid, uuid, uuid, payment_method, text, jsonb);
