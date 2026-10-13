-- A Unit Cost typed into the Margin Report only corrects the cost recorded on that
-- report's sold lines; it must not change the product's cost/Total in Stock. The
-- report normally shows the product's current Stock cost as its Unit Cost, so those
-- lines are marked cost_source = 'report' and the report shows their cost instead
-- (when every sold line in range carries it).
alter table order_items drop constraint if exists order_items_cost_source_check;
alter table order_items
  add constraint order_items_cost_source_check check (cost_source in ('direct', 'recipe', 'report'));

-- margin_report (0075) now also says whether a group of lines was set from the report.
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
             'cogs', l.cogs,
             'unit_cost', l.unit_cost,
             'paid_at', l.paid_at,
             'cost_overridden', l.cost_overridden
           )) as lines
    from (
      select oi.product_id, p.name, p.price, c.name as category_name,
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
      group by oi.product_id, p.name, p.price, c.name, 5, 6, 7
    ) l
    group by l.product_id, l.name, l.price, l.category_name
  ) g;
$$;

revoke execute on function margin_report(text[], uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function margin_report(text[], uuid, timestamptz, timestamptz) to service_role;
