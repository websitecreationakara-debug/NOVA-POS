-- The Margin Report's Selling Price is the price the product last SOLD at in the
-- range, not today's catalog price, so margin_report (0079) now also returns each
-- sold line's unit_price (lines are grouped by it as well as by cost). Older
-- sales keep the price they were sold at; a price change shows once an order is
-- made at the new price.
create or replace function margin_report(
  p_statuses text[],
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', g.product_id,
    'name', g.name,
    'price', g.price,
    'category_name', g.category_name,
    'lines', g.lines
  )), '[]'::jsonb)
  from (
    select l.product_id, l.name, l.price, l.category_name,
           jsonb_agg(jsonb_build_object(
             'quantity', l.quantity,
             'line_total', l.line_total,
             'unit_price', l.unit_price,
             'cogs', l.cogs,
             'unit_cost', l.unit_cost,
             'paid_at', l.paid_at,
             'cost_overridden', l.cost_overridden
           )) as lines
    from (
      select oi.product_id, p.name, p.price, c.name as category_name,
             oi.unit_price,
             case when coalesce(o.list_at, o.paid_at) is null then null
                  else round(coalesce(oi.unit_cost, oi.cogs / nullif(oi.quantity, 0)), 2)
             end as unit_cost,
             (oi.cogs is null) as cogs_unknown,
             coalesce(oi.cost_source = 'report', false) as cost_overridden,
             sum(oi.quantity) as quantity,
             sum(oi.line_total) as line_total,
             sum(oi.cogs) as cogs,
             max(coalesce(o.list_at, o.paid_at)) as paid_at
      from order_items oi
      join orders o on o.id = oi.order_id
      join products p on p.id = oi.product_id
      left join categories c on c.id = p.category_id
      where o.status = 'paid'
        and o.fulfillment_status::text = any (p_statuses)
        and o.list_at >= p_from and o.list_at <= p_to
        and (p_brand_id is null or p.brand_id = p_brand_id)
      group by oi.product_id, p.name, p.price, c.name, oi.unit_price, 6, 7, 8
    ) l
    group by l.product_id, l.name, l.price, l.category_name
  ) g;
$$;

revoke execute on function margin_report(text[], uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function margin_report(text[], uuid, timestamptz, timestamptz) to service_role;
