-- Product Insight overview, counted in the database. The page used to download
-- every sold line (about 40,000 for "All time") and add them up itself; this does
-- the adding here and sends back only the summary (a few hundred small rows).
--
-- Same rules as before: only lines of orders that count towards money (paid, and
-- Processing / Delivered / Complete), dated by the day the Orders list files the
-- order under (list_at, else paid_at; Phnom Penh days), optionally one business
-- (by the product's own business). p_from null = from the start.
create or replace function product_insight(
  p_from date,
  p_to date,
  p_brand uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
set enable_nestloop = off
as $$
  with lines as materialized (
    select oi.order_id,
           oi.product_id,
           oi.quantity,
           oi.line_total,
           p.name,
           p.brand_id,
           coalesce(c.name, 'Uncategorized') as category,
           (coalesce(o.list_at, o.paid_at) at time zone 'Asia/Phnom_Penh')::date as day
    from order_items oi
    join orders o on o.id = oi.order_id
    join products p on p.id = oi.product_id
    left join categories c on c.id = p.category_id
    where o.status = 'paid'
      and o.fulfillment_status::text in ('processing', 'delivered', 'complete')
      and (p_brand is null or p.brand_id = p_brand)
      and (coalesce(o.list_at, o.paid_at) at time zone 'Asia/Phnom_Penh')::date <= p_to
      and (p_from is null
           or (coalesce(o.list_at, o.paid_at) at time zone 'Asia/Phnom_Penh')::date >= p_from)
  ),
  totals as (
    select coalesce(sum(line_total), 0) as revenue,
           coalesce(sum(quantity), 0) as units,
           count(distinct order_id) as orders,
           count(distinct product_id) as products,
           min(day) as first_day
    from lines
  ),
  prod as materialized (
    select product_id, min(name) as name, sum(line_total) as revenue, sum(quantity) as units
    from lines
    group by product_id
  ),
  top_revenue as (
    select name, round(revenue, 2) as revenue, round(units, 2) as units
    from prod order by revenue desc, name limit 10
  ),
  top_units as (
    select name, round(revenue, 2) as revenue, round(units, 2) as units
    from prod order by units desc, name limit 10
  ),
  by_category as (
    select category as name, round(sum(line_total), 2) as value
    from lines group by category order by sum(line_total) desc, category
  ),
  by_brand as (
    select b.name, round(sum(l.line_total), 2) as value
    from lines l join brands b on b.id = l.brand_id
    group by b.name order by sum(l.line_total) desc, b.name
  ),
  days as (
    select day, round(sum(line_total), 2) as revenue, round(sum(quantity), 2) as units
    from lines group by day order by day
  ),
  one_per_order as materialized (
    select distinct order_id, product_id from lines
  ),
  pairs as (
    select pa.name as a, pb.name as b, count(*) as count
    from one_per_order x
    join one_per_order y on y.order_id = x.order_id and y.product_id > x.product_id
    join prod pa on pa.product_id = x.product_id
    join prod pb on pb.product_id = y.product_id
    group by x.product_id, y.product_id, pa.name, pb.name
    having count(*) >= 2
    order by count(*) desc, pa.name
    limit 8
  )
  select jsonb_build_object(
    'revenue', (select round(revenue, 2) from totals),
    'units', (select round(units, 2) from totals),
    'orders', (select orders from totals),
    'products', (select products from totals),
    'first_day', (select first_day from totals),
    'top_revenue', coalesce((select jsonb_agg(to_jsonb(t) order by t.revenue desc, t.name) from (select * from top_revenue) t), '[]'::jsonb),
    'top_units', coalesce((select jsonb_agg(to_jsonb(t) order by t.units desc, t.name) from (select * from top_units) t), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(to_jsonb(t) order by t.value desc, t.name) from (select * from by_category) t), '[]'::jsonb),
    'by_brand', coalesce((select jsonb_agg(to_jsonb(t) order by t.value desc, t.name) from (select * from by_brand) t), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(to_jsonb(t) order by t.day) from (select * from days) t), '[]'::jsonb),
    'pairs', coalesce((select jsonb_agg(to_jsonb(t) order by t.count desc, t.a, t.b) from (select * from pairs) t), '[]'::jsonb)
  );
$$;

revoke execute on function product_insight(date, date, uuid) from public, anon, authenticated;
grant execute on function product_insight(date, date, uuid) to service_role;
