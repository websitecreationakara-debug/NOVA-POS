-- Replaces marketing_customers() from migration 0064, which ran past the
-- database's 8-second limit: it let the planner re-scan the orders once per
-- customer. Here each total is worked out ONCE (MATERIALIZED), with the order
-- and product totals grouped in a single pass and joined to the customers.
-- Same arguments, same columns, same results.
create index if not exists orders_customer_id_idx on orders (customer_id);

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
  with counted as materialized (
    select id, customer_id, total
    from orders
    where status = 'paid'
      and fulfillment_status::text in ('processing', 'delivered', 'complete')
      and customer_id is not null
  ),
  order_stats as materialized (
    select customer_id, count(*) as orders_count, sum(total) as spent
    from counted
    group by customer_id
  ),
  unit_stats as materialized (
    select o.customer_id, sum(oi.quantity) as units
    from counted o
    join order_items oi on oi.order_id = o.id
    group by o.customer_id
  ),
  filtered as (
    select to_jsonb(c) as customer,
           c.name,
           c.id,
           coalesce(os.orders_count, 0) as orders_count,
           coalesce(us.units, 0) as units,
           coalesce(os.spent, 0) as spent
    from customers c
    left join order_stats os on os.customer_id = c.id
    left join unit_stats us on us.customer_id = c.id
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
