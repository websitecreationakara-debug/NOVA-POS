-- delete_order() and set_order_fulfillment_status() give stock back with a
-- plain `update stock_levels ... from order_items` -- which does nothing if
-- there's no stock_levels row yet for that product (createProductAction
-- never inserts one; it only appears the first time something touches that
-- product's stock). charge_order() and create_online_order() already guard
-- against exactly this on the way *down* (insert a row when one's missing
-- instead of silently no-op'ing) -- this brings the *restock* side up to the
-- same symmetry, so a cancelled/deleted order's stock is never silently
-- lost. Also switches the order_items join to a GROUP BY-aggregated
-- subquery (matching charge_order's own decrement), so an order with more
-- than one line for the same product restocks the full total instead of
-- whatever a single arbitrarily-matched row happened to hold.

create or replace function public.delete_order(p_order_id uuid)
returns setof uuid
language plpgsql
as $$
declare
  v_product_id uuid;
begin
  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + agg.total_qty, updated_at = now()
    from (
      select product_id, sum(quantity) as total_qty
      from order_items
      where order_id = p_order_id
      group by product_id
    ) as agg
    where s.product_id = agg.product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;

  for v_product_id in
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    select agg.product_id, agg.total_qty, 5
    from (
      select product_id, sum(quantity) as total_qty
      from order_items
      where order_id = p_order_id
      group by product_id
    ) as agg
    where not exists (select 1 from stock_levels sl where sl.product_id = agg.product_id)
    returning product_id
  loop
    return next v_product_id;
  end loop;

  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + agg.total_qty, updated_at = now()
    from (
      select oii.ingredient_product_id, sum(oii.quantity) as total_qty
      from order_item_ingredients oii
      join order_items oi on oi.id = oii.order_item_id
      where oi.order_id = p_order_id
      group by oii.ingredient_product_id
    ) as agg
    where s.product_id = agg.ingredient_product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;

  for v_product_id in
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    select agg.ingredient_product_id, agg.total_qty, 5
    from (
      select oii.ingredient_product_id, sum(oii.quantity) as total_qty
      from order_item_ingredients oii
      join order_items oi on oi.id = oii.order_item_id
      where oi.order_id = p_order_id
      group by oii.ingredient_product_id
    ) as agg
    where not exists (select 1 from stock_levels sl where sl.product_id = agg.ingredient_product_id)
    returning product_id
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
  v_product_id uuid;
  v_was_cancelled boolean;
  v_now_cancelled boolean := (p_status = 'cancelled');
  v_sign int;
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
  -- same update-then-insert-if-missing shape either way, just the sign of
  -- the quantity flips.
  v_sign := case when v_now_cancelled then 1 else -1 end;

  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + v_sign * agg.total_qty, updated_at = now()
    from (
      select product_id, sum(quantity) as total_qty
      from order_items
      where order_id = p_order_id
      group by product_id
    ) as agg
    where s.product_id = agg.product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;

  for v_product_id in
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    select agg.product_id, v_sign * agg.total_qty, 5
    from (
      select product_id, sum(quantity) as total_qty
      from order_items
      where order_id = p_order_id
      group by product_id
    ) as agg
    where not exists (select 1 from stock_levels sl where sl.product_id = agg.product_id)
    returning product_id
  loop
    return next v_product_id;
  end loop;

  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + v_sign * agg.total_qty, updated_at = now()
    from (
      select oii.ingredient_product_id, sum(oii.quantity) as total_qty
      from order_item_ingredients oii
      join order_items oi on oi.id = oii.order_item_id
      where oi.order_id = p_order_id
      group by oii.ingredient_product_id
    ) as agg
    where s.product_id = agg.ingredient_product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;

  for v_product_id in
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    select agg.ingredient_product_id, v_sign * agg.total_qty, 5
    from (
      select oii.ingredient_product_id, sum(oii.quantity) as total_qty
      from order_item_ingredients oii
      join order_items oi on oi.id = oii.order_item_id
      where oi.order_id = p_order_id
      group by oii.ingredient_product_id
    ) as agg
    where not exists (select 1 from stock_levels sl where sl.product_id = agg.ingredient_product_id)
    returning product_id
  loop
    return next v_product_id;
  end loop;
end;
$$;

revoke execute on function public.delete_order(uuid) from public, anon, authenticated;
grant execute on function public.delete_order(uuid) to service_role;
revoke execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) from public, anon, authenticated;
grant execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) to service_role;
