-- A Pre-Order keeps the date it was made until staff move it to any other
-- status. At that moment the order is dated that day instead: paid_at (the date
-- shown on the Orders list and printed on the invoice, and the day its revenue
-- is counted on) becomes the moment of the change. created_at is untouched, so
-- the original date is still on record.
--
-- Only the Pre-Order -> something-else step moves the date; later changes
-- (Processing -> Delivered ...) and moving back to Pre-Order leave it as it is.
--
-- Same function as migration 0055, plus the paid_at line.
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
  v_now_settled boolean := (p_status in ('delivered', 'complete', 'cancelled'));
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
      paid_at = case
        when v_was_pre_order and p_status <> 'pre_order' then now()
        else paid_at
      end,
      settled_at = case
        when not v_now_settled then null
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
