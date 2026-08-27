-- Deleting an order restores the stock it consumed (same spirit as voiding a
-- sale) and returns the affected product ids so the caller can push the
-- restored stock out to any linked storefront (see src/lib/site-sync.ts).
create or replace function public.delete_order(p_order_id uuid)
returns setof uuid
language plpgsql
as $$
declare
  v_product_id uuid;
begin
  for v_product_id in
    update stock_levels s
    set quantity = s.quantity + oi.quantity, updated_at = now()
    from order_items oi
    where oi.order_id = p_order_id and oi.product_id = s.product_id
    returning s.product_id
  loop
    return next v_product_id;
  end loop;

  delete from order_items where order_id = p_order_id;
  delete from orders where id = p_order_id;
end;
$$;

revoke execute on function public.delete_order(uuid) from public, anon, authenticated;
grant execute on function public.delete_order(uuid) to service_role;
