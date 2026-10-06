-- Revenue is counted on the order's list day (orders.list_at, migration 0062):
-- the day a Pre-Order was changed to another status, else its own paid_at.
-- paid_at itself -- the invoice's date and number -- is untouched.
-- Same function as migration 0058, with the day taken from list_at.
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
  delivery_fees numeric,
  order_share numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    ob.brand_id,
    b.name,
    to_char(coalesce(o.list_at, o.paid_at) at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD'),
    sum(o.total * ob.share),
    count(*),
    sum(coalesce(o.delivery_fee, 0) * ob.share),
    sum(ob.share)
  from orders o
  join order_brands ob on ob.order_id = o.id
  join brands b on b.id = ob.brand_id
  where o.status = 'paid'
    and o.fulfillment_status::text = any (p_statuses)
    and o.paid_at is not null
    and (p_brand_id is null or ob.brand_id = p_brand_id)
  group by ob.brand_id, b.name, 3
  order by 3, ob.brand_id;
$$;

revoke execute on function dashboard_order_days(text[], uuid) from public, anon, authenticated;
grant execute on function dashboard_order_days(text[], uuid) to service_role;
