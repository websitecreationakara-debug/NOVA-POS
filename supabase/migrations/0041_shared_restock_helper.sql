-- delete_order() and set_order_fulfillment_status() each carried their own
-- copy of "give back (or take again) the stock this order's items/ingredients
-- represent" -- two near-identical blocks that had to be kept in sync by
-- hand. That duplication is exactly how they drifted before (0038 fixed one
-- copy's missing-row/aggregation bug without touching the other; 0040 added
-- adjustment logging to only one of them). Extracted into one shared
-- restock_order_items() helper, signed (+1 gives stock back, -1 takes it
-- again) so both callers -- a real delete and a cancel/un-cancel status
-- change -- run the exact same stock-moving code, logged the same way,
-- forever in sync. Cancelling still never deletes the order; it's the same
-- stock process as delete, just without the two DELETE statements at the end.

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
    select product_id, sum(quantity) as total_qty
    from order_items
    where order_id = p_order_id
    group by product_id
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

revoke execute on function public.restock_order_items(uuid, int, text) from public, anon, authenticated;
grant execute on function public.restock_order_items(uuid, int, text) to service_role;

create or replace function public.delete_order(p_order_id uuid)
returns setof uuid
language plpgsql
as $$
declare
  v_product_id uuid;
begin
  for v_product_id in
    select * from public.restock_order_items(p_order_id, 1, 'Order deleted -- stock restored')
  loop
    return next v_product_id;
  end loop;

  delete from order_items where order_id = p_order_id;
  delete from orders where id = p_order_id;
end;
$$;

create or replace function public.set_order_fulfillment_status(
  p_order_id uuid,
  p_status fulfillment_status
)
returns setof uuid
language plpgsql
as $$
declare
  v_was_cancelled boolean;
  v_now_cancelled boolean := (p_status = 'cancelled');
  v_sign int;
  v_reason text;
  v_product_id uuid;
begin
  select fulfillment_status = 'cancelled' into v_was_cancelled
  from orders
  where id = p_order_id;

  if v_was_cancelled is null then
    return;
  end if;

  update orders set fulfillment_status = p_status where id = p_order_id;

  if v_was_cancelled = v_now_cancelled then
    return;
  end if;

  -- Cancelling gives stock back (+1); un-cancelling takes it again (-1) --
  -- same restock_order_items() a real delete uses, just without deleting
  -- anything.
  v_sign := case when v_now_cancelled then 1 else -1 end;
  v_reason := case
    when v_now_cancelled then 'Order cancelled -- stock restored'
    else 'Order un-cancelled -- stock taken again'
  end;

  for v_product_id in
    select * from public.restock_order_items(p_order_id, v_sign, v_reason)
  loop
    return next v_product_id;
  end loop;
end;
$$;

revoke execute on function public.delete_order(uuid) from public, anon, authenticated;
grant execute on function public.delete_order(uuid) to service_role;
revoke execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) from public, anon, authenticated;
grant execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) to service_role;
