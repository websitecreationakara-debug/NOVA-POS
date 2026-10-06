-- Replaces marketing_customers() from migration 0065 so the CRM list agrees with
-- the customer's purchase-history dialog. That dialog finds a customer's orders
-- by customer_id OR by the order's phone matching the customer's phone / second
-- phone (older and imported orders only carry the phone), skipping cancelled
-- and voided orders, and totals the items. The list did customer_id only, so
-- most customers showed 0 orders.
--
--   orders_count = orders found that way
--   units        = sum of item quantities
--   spent        = sum of item line totals (what the dialog calls Total spent)
--
-- Phone matches are three separate equality joins (hash joins), not one OR
-- condition, to keep it fast. Everything else is as in 0065.
create or replace function marketing_customers(
  p_search text default null,
  p_state text default null,
  p_gender text default null,
  p_age text default null,
  p_since_from date default null,
  p_since_to date default null,
  p_sort text default 'name',
  p_limit int default 50,
  p_offset int default 0
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
as $$
  with eligible as materialized (
    select id, customer_id, nullif(btrim(customer_phone), '') as phone
    from orders
    where status <> 'voided'
      and fulfillment_status::text <> 'cancelled'
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
  order_stats as materialized (
    select customer_id, count(*) as orders_count
    from links
    group by customer_id
  ),
  item_stats as materialized (
    select l.customer_id, sum(oi.quantity) as units, sum(oi.line_total) as spent
    from links l
    join order_items oi on oi.order_id = l.order_id
    group by l.customer_id
  ),
  filtered as (
    select to_jsonb(c) as customer,
           c.name,
           c.id,
           coalesce(os.orders_count, 0) as orders_count,
           coalesce(its.units, 0) as units,
           coalesce(its.spent, 0) as spent
    from customers c
    left join order_stats os on os.customer_id = c.id
    left join item_stats its on its.customer_id = c.id
    where (nullif(btrim(p_search), '') is null
           or c.name ilike '%' || btrim(p_search) || '%'
           or c.phone ilike '%' || btrim(p_search) || '%')
      and (nullif(p_state, '') is null or c.state = p_state)
      and (nullif(p_gender, '') is null or c.gender = p_gender)
      and (nullif(p_age, '') is null or c.age::text = p_age)
      and (p_since_from is null or c.customer_since >= p_since_from)
      and (p_since_to is null or c.customer_since <= p_since_to)
      and (p_sort not in ('spent', 'orders', 'units') or coalesce(os.orders_count, 0) > 0)
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

revoke execute on function marketing_customers(text, text, text, text, date, date, text, int, int) from public, anon, authenticated;
grant execute on function marketing_customers(text, text, text, text, date, date, text, int, int) to service_role;
