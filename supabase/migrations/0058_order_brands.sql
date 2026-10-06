-- One invoice can now hold products from several businesses. order_brands lists
-- every business on an order together with its `share` of that order (0..1,
-- the shares of one order add up to 1):
--   * an order whose lines all belong to one business -> a single row for
--     orders.brand_id with share 1, i.e. exactly how revenue was booked before;
--   * a mixed order -> one row per product brand, share = that brand's line
--     totals / all line totals. A business's revenue is orders.total * share, so
--     the order-level discount and delivery fee are split in proportion.
-- orders.brand_id stays the "main" business (letterhead on the invoice).
--
-- Kept up to date by triggers, so charge_order(), create_online_order() and the
-- order editor all stay as they are.
create table if not exists order_brands (
  order_id uuid not null references orders (id) on delete cascade,
  brand_id uuid not null references brands (id),
  share numeric not null check (share >= 0 and share <= 1),
  primary key (order_id, brand_id)
);
create index if not exists order_brands_brand_id_idx on order_brands (brand_id);

alter table order_brands enable row level security;

create or replace function refresh_order_brands(p_order_id uuid)
returns void
language plpgsql
as $$
begin
  -- The order itself is gone (cascade delete): nothing to rebuild.
  if not exists (select 1 from orders where id = p_order_id) then
    return;
  end if;

  delete from order_brands where order_id = p_order_id;

  insert into order_brands (order_id, brand_id, share)
  with line as (
    select p.brand_id, sum(oi.line_total) as amt
    from order_items oi
    join products p on p.id = oi.product_id
    where oi.order_id = p_order_id
    group by p.brand_id
  ),
  agg as (
    select count(*) as n, coalesce(sum(amt), 0) as total from line
  )
  -- Mixed order: split by each business's line totals (evenly if all are 0).
  select p_order_id, l.brand_id,
         case when a.total > 0 then l.amt / a.total else 1.0 / a.n end
  from line l, agg a
  where a.n > 1
  union all
  -- Single-business (or empty) order: the order's own business takes all of it.
  select p_order_id, o.brand_id, 1
  from orders o, agg a
  where o.id = p_order_id and a.n <= 1;
end;
$$;

create or replace function order_brands_on_order()
returns trigger
language plpgsql
as $$
begin
  perform refresh_order_brands(new.id);
  return null;
end;
$$;

create or replace function order_brands_on_item()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform refresh_order_brands(old.order_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.order_id is distinct from old.order_id) then
    perform refresh_order_brands(new.order_id);
  end if;
  return null;
end;
$$;

drop trigger if exists order_brands_order_trg on orders;
create trigger order_brands_order_trg
  after insert or update of brand_id on orders
  for each row execute function order_brands_on_order();

drop trigger if exists order_brands_item_trg on order_items;
create trigger order_brands_item_trg
  after insert or delete or update of order_id, product_id, line_total on order_items
  for each row execute function order_brands_on_item();

-- Existing orders: a row each (single-business ones get share 1, as before).
select refresh_order_brands(id) from orders;

-- Dashboard: revenue / delivery fees are now each business's share of its
-- orders, and a mixed order counts once in every business it touches. Because
-- that would count it 3 times in the "All businesses" total, `order_share`
-- (shares add up to 1 per order) is returned too for that total.
drop function if exists dashboard_order_days(text[], uuid);
create function dashboard_order_days(
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
    to_char(o.paid_at at time zone 'Asia/Phnom_Penh', 'YYYY-MM-DD'),
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
