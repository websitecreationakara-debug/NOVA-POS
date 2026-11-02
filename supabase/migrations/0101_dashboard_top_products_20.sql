-- The dashboard's Top Products card lists 20 products instead of 10 (dashboard_stats, migration 0071: only the
-- LIMIT of 'top_products' changes). The app works with either version.
create or replace function dashboard_stats(
  p_statuses text[],
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_from_day date,
  p_to_day date,
  p_min_price numeric
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'order_days', coalesce((
      select jsonb_agg(to_jsonb(d))
      from dashboard_order_days(p_statuses, p_brand_id) d
    ), '[]'::jsonb),

    'product_count', (
      select count(*) from products p
      where p.is_active and (p_brand_id is null or p.brand_id = p_brand_id)
    ),

    'recent_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'brand_name', b.name, 'status', r.status, 'total', r.total, 'paid_at', r.paid_at
      ) order by r.paid_at desc)
      from (
        select o.id, o.brand_id, o.status, o.total, o.paid_at
        from orders o
        where o.status = 'paid' and (p_brand_id is null or o.brand_id = p_brand_id)
        order by o.paid_at desc nulls last
        limit 5
      ) r
      left join brands b on b.id = r.brand_id
    ), '[]'::jsonb),

    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'quantity', t.quantity, 'revenue', t.revenue)
                       order by t.revenue desc, t.quantity desc)
      from (
        select p.name, sum(oi.quantity) as quantity, round(sum(oi.line_total), 2) as revenue
        from order_items oi
        join orders o on o.id = oi.order_id
        join products p on p.id = oi.product_id
        where o.status = 'paid'
          and o.fulfillment_status::text = any (p_statuses)
          and o.list_at >= p_from and o.list_at <= p_to
          and (p_brand_id is null or p.brand_id = p_brand_id)
          and oi.unit_price > p_min_price
        group by oi.product_id, p.name
        order by revenue desc, quantity desc
        limit 20
      ) t
    ), '[]'::jsonb),

    'known_cogs', coalesce((
      select sum(oi.cogs)
      from order_items oi
      join orders o on o.id = oi.order_id
      join products p on p.id = oi.product_id
      where o.status = 'paid'
        and o.fulfillment_status::text = any (p_statuses)
        and o.list_at >= p_from and o.list_at <= p_to
        and (p_brand_id is null or p.brand_id = p_brand_id)
        and oi.cogs is not null
    ), 0),

    'uncosted_lines', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', u.product_id, 'quantity', u.quantity))
      from (
        select oi.product_id, sum(oi.quantity) as quantity
        from order_items oi
        join orders o on o.id = oi.order_id
        join products p on p.id = oi.product_id
        where o.status = 'paid'
          and o.fulfillment_status::text = any (p_statuses)
          and o.list_at >= p_from and o.list_at <= p_to
          and (p_brand_id is null or p.brand_id = p_brand_id)
          and oi.cogs is null
        group by oi.product_id
      ) u
    ), '[]'::jsonb),

    'waste_cost', coalesce((
      select sum(sa.cost_impact)
      from stock_adjustments sa
      join products p on p.id = sa.product_id
      where sa.category = 'waste' and sa.cost_impact is not null
        and sa.created_at >= p_from and sa.created_at <= p_to
        and (p_brand_id is null or p.brand_id = p_brand_id)
    ), 0),

    'promotion_cost', coalesce((
      select sum(sa.cost_impact)
      from stock_adjustments sa
      join products p on p.id = sa.product_id
      where sa.category = 'promotion' and sa.cost_impact is not null
        and sa.created_at >= p_from and sa.created_at <= p_to
        and (p_brand_id is null or p.brand_id = p_brand_id)
    ), 0),

    'expense_total', coalesce((
      select sum(e.amount)
      from expenses e
      where e.expense_date >= p_from_day and e.expense_date <= p_to_day
        and (p_brand_id is null or e.brand_id = p_brand_id)
    ), 0)
  );
$$;

revoke execute on function dashboard_stats(text[], uuid, timestamptz, timestamptz, date, date, numeric) from public, anon, authenticated;
grant execute on function dashboard_stats(text[], uuid, timestamptz, timestamptz, date, date, numeric) to service_role;
