-- An order that has a delivery date/time (orders.delivery_at) and is Processing, Delivered or Complete
-- is filed -- and its revenue counted -- on the DELIVERY day, not the day the invoice was created.
-- E.g. invoiced 11/04, delivery 11/05 -> it shows and counts on 11/05.
--
-- Everything that lists or sums orders by day already reads orders.list_at (migration 0062), so only the
-- trigger rule changes: list_at = delivery_at for those statuses, else the old coalesce(settled_at, paid_at).
-- The invoice date / number (paid_at) is never touched. Pre-Order / New Order / Cancel, and orders with no
-- delivery date (ASAP / same day), keep the old rule. Run after 0106.
create or replace function orders_set_list_at()
returns trigger
language plpgsql
as $$
begin
  if new.delivery_at is not null
     and new.fulfillment_status in ('processing', 'delivered', 'complete') then
    new.list_at := new.delivery_at;
  else
    new.list_at := coalesce(new.settled_at, new.paid_at);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_list_at_trg on orders;
create trigger orders_list_at_trg
  before insert or update of paid_at, settled_at, delivery_at, fulfillment_status on orders
  for each row execute function orders_set_list_at();

-- Existing orders.
update orders
set list_at = case
  when delivery_at is not null and fulfillment_status in ('processing', 'delivered', 'complete') then delivery_at
  else coalesce(settled_at, paid_at)
end;
