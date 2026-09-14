-- Generalises cancel_order() (migration 0024): stock stays deducted for
-- every non-cancelled status (pre_order/new_order/processing/delivered/
-- complete -- total stock = current stock - order quantity) and is only
-- given back while the order sits at "cancelled" (total stock = current
-- stock + order quantity). Moving stock only when crossing that boundary --
-- not on every status change -- means cycling through statuses, or flipping
-- to/from cancelled repeatedly, never drifts stock away from the correct
-- total.
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

  if v_now_cancelled then
    for v_product_id in
      update stock_levels s
      set quantity = s.quantity + oi.quantity, updated_at = now()
      from order_items oi
      where oi.order_id = p_order_id and oi.product_id = s.product_id
      returning s.product_id
    loop
      return next v_product_id;
    end loop;
  else
    for v_product_id in
      update stock_levels s
      set quantity = s.quantity - oi.quantity, updated_at = now()
      from order_items oi
      where oi.order_id = p_order_id and oi.product_id = s.product_id
      returning s.product_id
    loop
      return next v_product_id;
    end loop;
  end if;
end;
$$;

revoke execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) from public, anon, authenticated;
grant execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) to service_role;

-- cancel_order() is superseded by the general function above.
drop function if exists public.cancel_order(uuid);
