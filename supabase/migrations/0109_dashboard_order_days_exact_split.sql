-- A mixed order's revenue / delivery fee was split as total * share, unrounded, per business. Each
-- business card then rounded its own sum, so the cards could add up a cent away from the All Business
-- card (e.g. $7,494.74 vs $7,494.75).
--
-- Now each business's part of an order is rounded to the cent, and the cents left over (or short) go to
-- the order's biggest share, so one order's parts always add up to its total exactly. Every business's
-- revenue is a whole number of cents, and the businesses add up to the All Business figure.
-- Same function as migration 0063 otherwise (day taken from list_at).
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
  with parts as (
    -- Every business of each order (the business filter comes after, so the leftover cent is
    -- always given to the same business no matter which one is being looked at).
    select
      ob.brand_id,
      to_char(coalesce(o.list_at, o.paid_at) at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD') as d,
      ob.share,
      round(o.total, 2) as total,
      round(coalesce(o.delivery_fee, 0), 2) as fee,
      round(o.total * ob.share, 2) as rev,
      round(coalesce(o.delivery_fee, 0) * ob.share, 2) as fee_part,
      o.id as order_id,
      row_number() over (partition by o.id order by ob.share desc, ob.brand_id) as rn
    from orders o
    join order_brands ob on ob.order_id = o.id
    where o.status = 'paid'
      and o.fulfillment_status::text = any (p_statuses)
      and o.paid_at is not null
  ),
  fixed as (
    select
      brand_id, d, share,
      rev + case when rn = 1 then total - sum(rev) over (partition by order_id) else 0 end as rev,
      fee_part + case when rn = 1 then fee - sum(fee_part) over (partition by order_id) else 0 end as fee_part
    from parts
  )
  select
    f.brand_id,
    b.name,
    f.d,
    sum(f.rev),
    count(*),
    sum(f.fee_part),
    sum(f.share)
  from fixed f
  join brands b on b.id = f.brand_id
  where p_brand_id is null or f.brand_id = p_brand_id
  group by f.brand_id, b.name, f.d
  order by f.d, f.brand_id;
$$;

revoke execute on function dashboard_order_days(text[], uuid) from public, anon, authenticated;
grant execute on function dashboard_order_days(text[], uuid) to service_role;
