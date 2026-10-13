-- Margin Report lines, grouped in the database. getMarginReport used to download
-- every sold order line in the range and group them by product in Node (about
-- 3 s for a year of sales). Now each product comes back with its lines already
-- collapsed to one row per recorded per-unit cost.
--
-- Same rules as getMarginReport:
--   * sold lines: paid orders in the counted fulfillment statuses, dated by
--     orders.list_at (falling back to paid_at), scoped to a business by the
--     PRODUCT's brand;
--   * a line's cost is its unit_cost, else cogs / quantity, rounded to cents --
--     null when neither is known, or when the line has no sale time (those lines
--     still count toward units / revenue / cogs, just not toward the cost breakdown);
--   * lines with no recorded cogs stay in their own group (cogs = null), so the
--     app can still tell a product's total COGS is unknown.
-- The app feeds these collapsed lines to the same summarizeMarginLines() as before.
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
             'paid_at', l.paid_at
           )) as lines
    from (
      select oi.product_id, p.name, p.price, c.name as category_name,
             case when coalesce(o.list_at, o.paid_at) is null then null
                  else round(coalesce(oi.unit_cost, oi.cogs / nullif(oi.quantity, 0)), 2)
             end as unit_cost,
             (oi.cogs is null) as cogs_unknown,
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
      group by oi.product_id, p.name, p.price, c.name, 5, 6
    ) l
    group by l.product_id, l.name, l.price, l.category_name
  ) g;
$$;

revoke execute on function margin_report(text[], uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function margin_report(text[], uuid, timestamptz, timestamptz) to service_role;
