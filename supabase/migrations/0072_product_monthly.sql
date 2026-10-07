-- "Insight by Quantity" / "Insight by Price", counted in the database. The page
-- used to download every sold line of the year (tens of thousands) and add them
-- up per product and month itself; this sends back one small row per product with
-- its 12 monthly quantities and amounts.
--
-- Same rules as product_insight (migration 0070): only lines of orders that count
-- towards money (paid, and Processing / Delivered / Complete), dated by the day
-- the Orders list files the order under (list_at, else paid_at; Phnom Penh days),
-- optionally one business (by the product's own business).
create or replace function product_monthly(
  p_year int,
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
    select oi.product_id,
           oi.quantity,
           oi.line_total,
           extract(month from (coalesce(o.list_at, o.paid_at) at time zone 'Asia/Phnom_Penh'))::int as mo
    from order_items oi
    join orders o on o.id = oi.order_id
    join products p on p.id = oi.product_id
    where o.status = 'paid'
      and o.fulfillment_status::text in ('processing', 'delivered', 'complete')
      and (p_brand is null or p.brand_id = p_brand)
      and extract(year from (coalesce(o.list_at, o.paid_at) at time zone 'Asia/Phnom_Penh'))::int = p_year
  ),
  by_month as (
    select product_id, mo, sum(quantity) as qty, sum(line_total) as amount
    from lines
    group by product_id, mo
  )
  select coalesce(jsonb_agg(
    jsonb_build_object('id', r.id, 'name', r.name, 'unit', r.unit, 'qty', r.qty, 'amount', r.amount)
    order by r.name
  ), '[]'::jsonb)
  from (
    select p.id,
           p.name,
           coalesce(nullif(btrim(p.unit_km), ''), nullif(btrim(p.unit), ''), '') as unit,
           jsonb_agg(coalesce(round(bm.qty, 2), 0) order by m.mo) as qty,
           jsonb_agg(coalesce(round(bm.amount, 2), 0) order by m.mo) as amount
    from (select distinct product_id from by_month) sold
    join products p on p.id = sold.product_id
    cross join generate_series(1, 12) as m(mo)
    left join by_month bm on bm.product_id = sold.product_id and bm.mo = m.mo
    group by p.id, p.name, p.unit_km, p.unit
  ) r;
$$;

revoke execute on function product_monthly(int, uuid) from public, anon, authenticated;
grant execute on function product_monthly(int, uuid) to service_role;
