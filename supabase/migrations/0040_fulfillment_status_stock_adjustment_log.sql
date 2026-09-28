-- set_order_fulfillment_status() moves stock on every cancel/un-cancel but
-- never records why -- unlike adjust_stock() (manual Stock-page edits) and
-- create_online_order()/charge_order() (the original sale), which all write
-- to stock_adjustments. That gap made a real incident undiagnosable: a
-- cancelled order's stock silently wasn't restored once, and there was no
-- record of what the function did or didn't do at that moment -- only the
-- order's current status and the product's current quantity, with nothing
-- connecting them. This adds the same logging every other stock-moving path
-- already has, so a future recurrence shows up as a stock_adjustments row
-- instead of requiring after-the-fact forensics.
--
-- Restructured (from migration 0038) to loop once per product with its
-- aggregated quantity in hand, upserting stock_levels and logging the
-- adjustment together, instead of two separate blind update/insert passes.

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
  v_rec record;
  v_cost_price numeric(12, 2);
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

  -- Cancelling gives stock back (+1); un-cancelling takes it again (-1).
  v_sign := case when v_now_cancelled then 1 else -1 end;
  v_reason := case
    when v_now_cancelled then 'Order cancelled -- stock restored'
    else 'Order un-cancelled -- stock taken again'
  end;

  for v_rec in
    select product_id, sum(quantity) as total_qty
    from order_items
    where order_id = p_order_id
    group by product_id
  loop
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    values (v_rec.product_id, v_sign * v_rec.total_qty, 5)
    on conflict (product_id) do update
      set quantity = stock_levels.quantity + v_sign * v_rec.total_qty, updated_at = now();

    select cost_price into v_cost_price from products where id = v_rec.product_id;
    insert into stock_adjustments (product_id, delta, reason, created_by, category, cost_impact, created_at)
    values (
      v_rec.product_id, v_sign * v_rec.total_qty, v_reason, null, 'other',
      case when v_sign < 0 and v_cost_price is not null then v_rec.total_qty * v_cost_price else null end,
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
    values (v_rec.product_id, v_sign * v_rec.total_qty, 5)
    on conflict (product_id) do update
      set quantity = stock_levels.quantity + v_sign * v_rec.total_qty, updated_at = now();

    select cost_price into v_cost_price from products where id = v_rec.product_id;
    insert into stock_adjustments (product_id, delta, reason, created_by, category, cost_impact, created_at)
    values (
      v_rec.product_id, v_sign * v_rec.total_qty, v_reason || ' (recipe ingredient)', null, 'other',
      case when v_sign < 0 and v_cost_price is not null then v_rec.total_qty * v_cost_price else null end,
      now()
    );

    return next v_rec.product_id;
  end loop;
end;
$$;

revoke execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) from public, anon, authenticated;
grant execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) to service_role;
