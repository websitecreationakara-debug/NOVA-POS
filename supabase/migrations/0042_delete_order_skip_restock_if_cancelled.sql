-- delete_order() always restocked, regardless of the order's current status
-- -- so deleting an order that was already cancelled (whose stock was
-- already given back by that cancel) gave it back a second time, silently
-- inflating stock. Confirmed live: cancel an order (stock correctly
-- restored), then delete it, and stock goes up again by the same amount.
-- Now skips the restock entirely when the order is already cancelled, since
-- there's nothing left owed back.

create or replace function public.delete_order(p_order_id uuid)
returns setof uuid
language plpgsql
as $$
declare
  v_product_id uuid;
  v_is_cancelled boolean;
begin
  select fulfillment_status = 'cancelled' into v_is_cancelled
  from orders
  where id = p_order_id;

  if v_is_cancelled is not true then
    for v_product_id in
      select * from public.restock_order_items(p_order_id, 1, 'Order deleted -- stock restored')
    loop
      return next v_product_id;
    end loop;
  end if;

  delete from order_items where order_id = p_order_id;
  delete from orders where id = p_order_id;
end;
$$;

revoke execute on function public.delete_order(uuid) from public, anon, authenticated;
grant execute on function public.delete_order(uuid) to service_role;
