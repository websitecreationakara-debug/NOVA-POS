-- A sale's recorded cost (order_items.unit_cost, set by charge_order / create_online_order through
-- effective_product_cost) was the listing's Purchase Cost Total. The Margin Report's Unit Cost for a product
-- linked to a Stock listing is its Total Cost 10%, so a new order now records that: when the listing has a
-- Total Cost 10%, it is the cost; otherwise the same fallback as before. Orders already placed keep the cost
-- they were recorded at. Run after 0102.
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
begin
  select cost_price into v_cost_price from products where id = p_product_id;

  select site, site_product_id, variation_id into v_link
  from product_site_links
  where product_id = p_product_id
  limit 1;

  if v_link is null then
    return v_cost_price;
  end if;

  select original_cost, total_cost_10pct, extra_money, total_override into v_cost_row
  from website_product_purchase_costs
  where site = v_link.site
    and site_product_id = v_link.site_product_id
    and variation_id = v_link.variation_id;

  if v_cost_row is null then
    return v_cost_price;
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

  return coalesce(v_total, v_cost_price);
end;
$$;

revoke execute on function public.effective_product_cost(uuid) from public, anon, authenticated;
grant execute on function public.effective_product_cost(uuid) to service_role;
