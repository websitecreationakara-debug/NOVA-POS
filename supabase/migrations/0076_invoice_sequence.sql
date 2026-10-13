-- Invoice sequence numbers for a page of orders, counted in the database.
-- getOrdersList used to run two queries per month on the page: a count of the
-- month's earlier orders, plus a list of every paid order id between the page's
-- oldest and newest order (large when a filter spans months).
--
-- Same rule as before: an order's number is its position among ALL paid orders of
-- its Phnom Penh month, oldest first by (paid_at, id), so it doesn't depend on
-- filters or paging. Returns { "<order id>": <position> } for the ids asked about.
-- Uses the orders_paid_paid_at_idx partial index from 0071.
create or replace function invoice_sequence(p_order_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_object_agg(t.id, t.seq), '{}'::jsonb)
  from (
    select o.id,
           1 + (
             select count(*)
             from orders x
             where x.status = 'paid'
               and x.paid_at >= (date_trunc('month', o.paid_at at time zone 'Asia/Phnom_Penh') at time zone 'Asia/Phnom_Penh')
               and (x.paid_at < o.paid_at or (x.paid_at = o.paid_at and x.id < o.id))
           ) as seq
    from orders o
    where o.id = any (p_order_ids) and o.paid_at is not null
  ) t;
$$;

revoke execute on function invoice_sequence(uuid[]) from public, anon, authenticated;
grant execute on function invoice_sequence(uuid[]) to service_role;
