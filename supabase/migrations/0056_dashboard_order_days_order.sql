-- dashboard_order_days() returns one row per business per day, which is more
-- than the 1000 rows the database hands back per request once there are a few
-- years of orders, so the app now reads it a page at a time. Paging needs a
-- fixed row order -- without one, pages can repeat or skip rows -- so this adds
-- an ORDER BY. Same signature and columns as migration 0053.
create or replace function dashboard_order_days(
  p_statuses text[],
  p_brand_id uuid default null
)
returns table (
  brand_id uuid,
  brand_name text,
  day text,
  revenue numeric,
  orders bigint,
  delivery_fees numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    o.brand_id,
    b.name,
    to_char(o.paid_at at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD'),
    sum(o.total),
    count(*),
    sum(coalesce(o.delivery_fee, 0))
  from orders o
  join brands b on b.id = o.brand_id
  where o.status = 'paid'
    and o.fulfillment_status::text = any (p_statuses)
    and o.paid_at is not null
    and (p_brand_id is null or o.brand_id = p_brand_id)
  group by o.brand_id, b.name, 3
  order by 3, o.brand_id;
$$;

revoke execute on function dashboard_order_days(text[], uuid) from public, anon, authenticated;
grant execute on function dashboard_order_days(text[], uuid) to service_role;
