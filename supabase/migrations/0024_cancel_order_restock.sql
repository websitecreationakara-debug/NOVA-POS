-- Cancelling an order returns the stock it consumed, same idea as deleting
-- one (see delete_order, migration 0016) -- so a cancelled order's items go
-- back on the shelf (current stock + order quantity) instead of staying
-- reserved forever. Idempotent: cancelling an already-cancelled order (or a
-- missing one) restocks nothing, so flipping the status back and forth can't
-- refund the same stock twice.
create or replace function public.cancel_order(p_order_id uuid)
returns setof uuid
language plpgsql
as $$
declare
  v_product_id uuid;
  v_already_cancelled boolean;
begin
  select fulfillment_status = 'cancelled' into v_already_cancelled
  from orders
  where id = p_order_id;

  update orders set fulfillment_status = 'cancelled' where id = p_order_id;

  if coalesce(v_already_cancelled, true) then
    return;
  end if;

  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + oi.quantity, updated_at = now()
    from order_items oi
    where oi.order_id = p_order_id and oi.product_id = s.product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;
end;
$$;

revoke execute on function public.cancel_order(uuid) from public, anon, authenticated;
grant execute on function public.cancel_order(uuid) to service_role;
