-- Marketing > CRM: filter the customer list by business. Same function as migration 0068 with one more
-- (optional) argument, p_brand_id:
--   * only customers who bought from that business are listed (an order counts for every business on it,
--     see order_brands, migration 0058);
--   * their Orders / Products / Spent then count only what they bought from that business: the orders that
--     touch it, and the lines of its products.
-- With p_brand_id null nothing changes.
drop function if exists marketing_customers(text, text, text, text, date, date, text, int, int, date, date);

create or replace function marketing_customers(
  p_search text default null,
  p_state text default null,
  p_gender text default null,
  p_age text default null,
  p_since_from date default null,
  p_since_to date default null,
  p_sort text default 'name',
  p_limit int default 50,
  p_offset int default 0,
  p_bought_from date default null,
  p_bought_to date default null,
  p_brand_id uuid default null
)
returns table (
  customer jsonb,
  total_count bigint,
  orders_count bigint,
  units numeric,
  spent numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog
set enable_nestloop = off
as $$
  with eligible as materialized (
    select id, customer_id, nullif(btrim(customer_phone), '') as phone
    from orders
    where status <> 'voided'
      and fulfillment_status::text <> 'cancelled'
      and (p_bought_from is null
           or (coalesce(list_at, paid_at) at time zone 'Asia/Phnom_Penh')::date >= p_bought_from)
      and (p_bought_to is null
           or (coalesce(list_at, paid_at) at time zone 'Asia/Phnom_Penh')::date <= p_bought_to)
      and (p_brand_id is null
           or exists (select 1 from order_brands ob where ob.order_id = orders.id and ob.brand_id = p_brand_id))
  ),
  links as materialized (
    select e.id as order_id, c.id as customer_id
    from eligible e join customers c on c.id = e.customer_id
    union
    select e.id, c.id
    from eligible e join customers c on nullif(btrim(c.phone), '') = e.phone
    union
    select e.id, c.id
    from eligible e join customers c on nullif(btrim(c.second_phone), '') = e.phone
  ),
  stats as materialized (
    select l.customer_id,
           count(distinct l.order_id) as orders_count,
           coalesce(sum(oi.quantity) filter (where p_brand_id is null or pr.brand_id = p_brand_id), 0) as units,
           coalesce(sum(oi.line_total) filter (where p_brand_id is null or pr.brand_id = p_brand_id), 0) as spent
    from links l
    left join order_items oi on oi.order_id = l.order_id
    left join products pr on pr.id = oi.product_id
    group by l.customer_id
  ),
  filtered as (
    select to_jsonb(c) as customer,
           c.name,
           c.id,
           coalesce(s.orders_count, 0) as orders_count,
           coalesce(s.units, 0) as units,
           coalesce(s.spent, 0) as spent
    from customers c
    left join stats s on s.customer_id = c.id
    where (nullif(btrim(p_search), '') is null
           or c.name ilike '%' || btrim(p_search) || '%'
           or c.phone ilike '%' || btrim(p_search) || '%')
      and (nullif(p_state, '') is null or c.state = p_state)
      and (nullif(p_gender, '') is null or c.gender = p_gender)
      and (nullif(p_age, '') is null or c.age::text = p_age)
      and (p_since_from is null or c.customer_since >= p_since_from)
      and (p_since_to is null or c.customer_since <= p_since_to)
      and (p_sort not in ('spent', 'orders', 'units') or coalesce(s.orders_count, 0) > 0)
      and ((p_bought_from is null and p_bought_to is null and p_brand_id is null) or coalesce(s.orders_count, 0) > 0)
  )
  select f.customer, count(*) over (), f.orders_count, f.units, f.spent
  from filtered f
  order by
    case when p_sort = 'spent' then f.spent end desc,
    case when p_sort = 'orders' then f.orders_count end desc,
    case when p_sort = 'units' then f.units end desc,
    f.name,
    f.id
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
$$;

revoke execute on function marketing_customers(text, text, text, text, date, date, text, int, int, date, date, uuid) from public, anon, authenticated;
grant execute on function marketing_customers(text, text, text, text, date, date, text, int, int, date, date, uuid) to service_role;
