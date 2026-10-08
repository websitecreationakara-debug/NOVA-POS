-- A running history of every stock quantity change, so the Accounting > COGS tab can
-- show the real Beginning / Ending inventory for any past date instead of an estimate.
--
-- stock_levels only holds the quantity *now*. A trigger on it records each change --
-- whatever caused it (a sale, a restock, waste, a website sync, a manual edit) -- with
-- the quantity left afterwards, so the quantity at any moment is the last row at or
-- before it. History starts when this migration runs (a "baseline" row per product
-- holds the quantity at that moment); earlier dates can't be reconstructed.
create table public.stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  delta numeric(12, 2) not null,
  quantity_after numeric(12, 2) not null,
  kind text not null default 'change' check (kind in ('baseline', 'change')),
  created_at timestamptz not null default now()
);

create index stock_movements_product_time_idx on public.stock_movements (product_id, created_at desc, id desc);

alter table public.stock_movements enable row level security;

-- security definer: stock_levels is updated by several roles, none of which should
-- need direct write access to the history table.
create or replace function public.log_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 0 then
      insert into public.stock_movements (product_id, delta, quantity_after)
      values (new.product_id, new.quantity, new.quantity);
    end if;
  elsif new.quantity is distinct from old.quantity then
    insert into public.stock_movements (product_id, delta, quantity_after)
    values (new.product_id, new.quantity - old.quantity, new.quantity);
  end if;
  return new;
end;
$$;

-- The starting point: today's quantity for every product that exists now.
insert into public.stock_movements (product_id, delta, quantity_after, kind)
select product_id, 0, quantity, 'baseline' from public.stock_levels;

create trigger stock_levels_log_movement
  after insert or update of quantity on public.stock_levels
  for each row
  execute function public.log_stock_movement();

-- Units on hand at the start (just before p_from) and the end (at p_to) of a range, for
-- one business or all (p_brand_id null), plus when the history began so the app can
-- tell whether a range is covered. Active products only, like the Stock page.
create or replace function public.stock_units_between(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'history_start', (select min(created_at) from public.stock_movements where kind = 'baseline'),
    'beginning', coalesce((
      select sum(b.q) from (
        select distinct on (m.product_id) m.quantity_after as q
        from public.stock_movements m
        join public.products p on p.id = m.product_id
        where p.is_active
          and (p_brand_id is null or p.brand_id = p_brand_id)
          and m.created_at < p_from
        order by m.product_id, m.created_at desc, m.id desc
      ) b
    ), 0),
    'ending', coalesce((
      select sum(e.q) from (
        select distinct on (m.product_id) m.quantity_after as q
        from public.stock_movements m
        join public.products p on p.id = m.product_id
        where p.is_active
          and (p_brand_id is null or p.brand_id = p_brand_id)
          and m.created_at <= p_to
        order by m.product_id, m.created_at desc, m.id desc
      ) e
    ), 0)
  );
$$;

revoke execute on function public.stock_units_between(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.stock_units_between(uuid, timestamptz, timestamptz) to service_role;
