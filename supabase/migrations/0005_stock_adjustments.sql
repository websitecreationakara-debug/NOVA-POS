-- Phase 3: manual stock adjustments for the Stock role.
--
-- Mirrors charge_order()'s pattern: the adjustment log entry and the
-- stock_levels update happen in one transaction so they can't drift apart.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta numeric,
  p_reason text,
  p_created_by uuid
)
returns numeric
language plpgsql
as $$
declare
  v_new_quantity numeric(12, 2);
begin
  if p_delta = 0 then
    raise exception 'Adjustment delta cannot be zero';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Adjustment reason is required';
  end if;

  insert into stock_adjustments (product_id, delta, reason, created_by)
  values (p_product_id, p_delta, p_reason, p_created_by);

  update stock_levels
  set quantity = quantity + p_delta, updated_at = now()
  where product_id = p_product_id
  returning quantity into v_new_quantity;

  if not found then
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    values (p_product_id, p_delta, 0)
    returning quantity into v_new_quantity;
  end if;

  return v_new_quantity;
end;
$$;

revoke execute on function public.adjust_stock(uuid, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text, uuid)
  to service_role;
