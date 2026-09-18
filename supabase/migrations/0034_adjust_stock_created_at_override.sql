-- adjust_stock(): gains an optional created_at override so Accountance's
-- "Add waste item" form can backdate an entry to when the waste actually
-- happened (matches the Expense form, which already lets you pick a date)
-- instead of always stamping "now" -- otherwise a waste item logged today
-- for something that happened on 2026-09-15 always showed up under today
-- in the Waste log, never under the 15th.
-- A new parameter changes the function's signature, so the old 6-arg
-- overload is dropped explicitly (same pattern as 0033_adjust_stock_cost_override.sql).
drop function if exists public.adjust_stock(uuid, numeric, text, uuid, text, numeric);

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_delta numeric,
  p_reason text,
  p_created_by uuid,
  p_category text default 'other',
  p_cost_price_override numeric default null,
  p_created_at timestamptz default null
)
returns numeric
language plpgsql
as $$
declare
  v_new_quantity numeric(12, 2);
  v_category text;
  v_cost_price numeric(12, 2);
  v_cost_impact numeric(12, 2);
begin
  if p_delta = 0 then
    raise exception 'Adjustment delta cannot be zero';
  end if;

  v_category := case when p_category in ('waste', 'promotion', 'other') then p_category else 'other' end;

  select cost_price into v_cost_price from products where id = p_product_id;
  v_cost_price := coalesce(p_cost_price_override, v_cost_price);
  v_cost_impact := case when p_delta < 0 and v_cost_price is not null then -p_delta * v_cost_price else null end;

  insert into stock_adjustments (product_id, delta, reason, created_by, category, cost_impact, created_at)
  values (
    p_product_id, p_delta, nullif(btrim(p_reason), ''), p_created_by, v_category, v_cost_impact,
    coalesce(p_created_at, now())
  );

  update stock_levels
  set quantity = quantity + p_delta, updated_at = now()
  where product_id = p_product_id
  returning quantity into v_new_quantity;

  if not found then
    insert into stock_levels (product_id, quantity, low_stock_threshold)
    values (p_product_id, p_delta, 5)
    returning quantity into v_new_quantity;
  end if;

  return v_new_quantity;
end;
$$;

revoke execute on function public.adjust_stock(uuid, numeric, text, uuid, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.adjust_stock(uuid, numeric, text, uuid, text, numeric, timestamptz) to service_role;
