-- A product with no cost anywhere (no Stock Total Cost 10%, no Total, no cost price) still has a Unit Cost when
-- one was typed into the Margin Report: that cost sits on its sold lines (order_items.cost_source = 'report').
-- A new sale now takes the cost last typed there instead of being recorded with no cost (a "—" in the report's
-- Sales table). A cost from Stock still wins. Orders already placed keep their cost. Run after 0103.
create or replace function public.effective_product_cost(p_product_id uuid)
returns numeric
language plpgsql
as $$
declare
  v_cost_price numeric(12, 2);
  v_link record;
  v_cost_row record;
  v_purchase_cost numeric(12, 2);
  v_total numeric(12, 2);
  v_typed numeric(12, 2);
begin
  select cost_price into v_cost_price from products where id = p_product_id;

  -- The cost last typed into the Margin Report for this product (used only when nothing else gives a cost).
  select oi.unit_cost into v_typed
  from order_items oi
  join orders o on o.id = oi.order_id
  where oi.product_id = p_product_id
    and oi.cost_source = 'report'
    and oi.unit_cost is not null
  order by o.paid_at desc nulls last
  limit 1;

  select site, site_product_id, variation_id into v_link
  from product_site_links
  where product_id = p_product_id
  limit 1;

  if v_link is null then
    return coalesce(v_cost_price, v_typed);
  end if;

  select original_cost, total_cost_10pct, extra_money, total_override into v_cost_row
  from website_product_purchase_costs
  where site = v_link.site
    and site_product_id = v_link.site_product_id
    and variation_id = v_link.variation_id;

  if v_cost_row is null then
    return coalesce(v_cost_price, v_typed);
  end if;

  -- The Stock listing's Total Cost 10% is the sale's cost.
  if v_cost_row.total_cost_10pct is not null then
    return v_cost_row.total_cost_10pct;
  end if;

  if v_cost_row.original_cost is null or v_cost_row.total_cost_10pct is null then
    v_purchase_cost := null;
  else
    v_purchase_cost := round((v_cost_row.original_cost + v_cost_row.total_cost_10pct) / 2, 2);
  end if;

  if v_purchase_cost is null then
    v_total := null;
  elsif v_cost_row.extra_money is null then
    v_total := v_purchase_cost;
  else
    v_total := round(v_purchase_cost + v_cost_row.extra_money, 2);
  end if;

  v_total := coalesce(v_cost_row.total_override, v_total);

  return coalesce(v_total, v_cost_price, v_typed);
end;
$$;

revoke execute on function public.effective_product_cost(uuid) from public, anon, authenticated;
grant execute on function public.effective_product_cost(uuid) to service_role;
