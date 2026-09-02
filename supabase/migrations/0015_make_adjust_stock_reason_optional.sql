-- Manual stock adjustments no longer require a reason -- it was adding
-- friction for quick corrections. Reason is still stored (and still shown in
-- the UI as an optional field) for whoever wants to leave one.
alter table stock_adjustments alter column reason drop not null;

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

  insert into stock_adjustments (product_id, delta, reason, created_by)
  values (p_product_id, p_delta, nullif(btrim(p_reason), ''), p_created_by);

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
