-- Per-business, per-day totals of the paid, counted orders -- everything the
-- Dashboard's revenue/orders charts, headline cards and Top Branch list need,
-- summed in the database instead of downloading every order row (thousands, and
-- growing) just to add them up in the app. Days are Phnom Penh calendar days,
-- same as phnomPenhTime.ppDay(). p_statuses is the app's
-- COUNTED_FULFILLMENT_STATUSES so the list lives in one place.
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
  group by o.brand_id, b.name, 3;
$$;

revoke execute on function dashboard_order_days(text[], uuid) from public, anon, authenticated;
grant execute on function dashboard_order_days(text[], uuid) to service_role;
