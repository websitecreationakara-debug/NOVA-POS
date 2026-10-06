-- The Orders list files an order under the day its status was changed away from
-- Pre-Order (settled_at, see migration 0061), while the order itself keeps its
-- own date: paid_at -- and with it the invoice number and printed date, and every
-- revenue report -- is never touched.
--
-- list_at is that "list day": settled_at when the order has one, else paid_at.
-- A trigger keeps it current, so the list can order, filter and page by it in
-- the database.
alter table orders add column if not exists list_at timestamptz;

create or replace function orders_set_list_at()
returns trigger
language plpgsql
as $$
begin
  new.list_at := coalesce(new.settled_at, new.paid_at);
  return new;
end;
$$;

drop trigger if exists orders_list_at_trg on orders;
create trigger orders_list_at_trg
  before insert or update of paid_at, settled_at on orders
  for each row execute function orders_set_list_at();

-- Existing orders (an order finished straight from Pre-Order earlier already
-- has a settled_at, so it moves to that day too).
update orders set list_at = coalesce(settled_at, paid_at);

create index if not exists orders_list_at_idx on orders (list_at desc);
