-- Marketing > CRM customer list: filters (state, gender, age, customer since)
-- and "top buying" ranking, done in the database so they cover all customers
-- and page correctly.
--
-- A customer's buying is worked out from their orders that count towards money
-- (paid, and Processing / Delivered / Complete -- same rule as revenue):
--   orders_count = number of orders, units = products bought (sum of item
--   quantities), spent = sum of order totals.
-- p_sort 'spent' | 'orders' | 'units' ranks buyers highest first and leaves out
-- customers with no counted order; anything else sorts by name.
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
  with stats as (
    select o.customer_id,
           count(*) as orders_count,
           sum(o.total) as spent,
           coalesce(sum((select sum(oi.quantity) from order_items oi where oi.order_id = o.id)), 0) as units
    from orders o
    where o.status = 'paid'
      and o.fulfillment_status::text in ('processing', 'delivered', 'complete')
      and o.customer_id is not null
    group by o.customer_id
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

-- The choices for the State / Age / Gender dropdowns, with how many customers
-- have each.
create or replace function marketing_customer_filter_options()
returns table (kind text, value text, n bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select 'state'::text, c.state, count(*) from customers c
    where c.state is not null and btrim(c.state) <> '' group by c.state
  union all
  select 'age'::text, c.age::text, count(*) from customers c
    where c.age is not null and btrim(c.age::text) <> '' group by c.age
  union all
  select 'gender'::text, c.gender, count(*) from customers c
    where c.gender is not null and btrim(c.gender) <> '' group by c.gender;
$$;

revoke execute on function marketing_customers(text, text, text, text, date, date, text, int, int) from public, anon, authenticated;
grant execute on function marketing_customers(text, text, text, text, date, date, text, int, int) to service_role;
revoke execute on function marketing_customer_filter_options() from public, anon, authenticated;
grant execute on function marketing_customer_filter_options() to service_role;
