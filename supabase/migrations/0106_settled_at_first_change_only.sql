-- Replaces migration 0061's rule for settled_at (the day the Orders list files a Pre-Order under):
--   * Pre-Order -> any other status: settled_at = now() (as before);
--   * a LATER status change (Processing -> Delivered -> Complete, ...): settled_at stays, so the order
--     keeps the day it was first moved out of Pre-Order instead of following every click;
--   * back to Pre-Order: cleared.
-- Orders already moved by a later change keep the day they are on now. Run after 0105.
create or replace function public.set_order_fulfillment_status(
  p_order_id uuid,
  p_status fulfillment_status
)
returns setof uuid
language plpgsql
as $$
declare
  v_was_cancelled boolean;
  v_was_pre_order boolean;
  v_now_cancelled boolean := (p_status = 'cancelled');
  v_sign int;
  v_reason text;
  v_product_id uuid;
begin
  select fulfillment_status = 'cancelled', fulfillment_status = 'pre_order'
    into v_was_cancelled, v_was_pre_order
  from orders
  where id = p_order_id;

  if v_was_cancelled is null then
    return;
  end if;

  update orders
  set fulfillment_status = p_status,
      settled_at = case
        when p_status = 'pre_order' then null
        when v_was_pre_order then now()
        else settled_at
      end
  where id = p_order_id;

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

revoke execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) from public, anon, authenticated;
grant execute on function public.set_order_fulfillment_status(uuid, fulfillment_status) to service_role;
