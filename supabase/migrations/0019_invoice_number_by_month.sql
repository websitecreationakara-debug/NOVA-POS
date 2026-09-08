-- Invoice numbers now follow the month an order is created in: `YYYYMM-NN`
-- (e.g. 202609-66), NN restarting at 1 each calendar month (Asia/Phnom_Penh,
-- so the number lines up with the local invoice date). Existing orders keep
-- their old global `INV-000045` numbers.
--
-- Implemented as a BEFORE INSERT trigger on `orders` rather than by editing
-- charge_order(), so it also covers the online-order sync path and doesn't
-- depend on that function's current body. A dedicated counter table keeps the
-- next number race-free under concurrent checkouts.

create table if not exists invoice_counters (
  period text primary key,          -- 'YYYYMM' in Asia/Phnom_Penh
  last_seq integer not null default 0
);

create or replace function public.next_invoice_number()
returns text
language plpgsql
as $$
declare
  v_period text := to_char((now() at time zone 'Asia/Phnom_Penh'), 'YYYYMM');
  v_seq integer;
begin
  insert into invoice_counters (period, last_seq)
  values (v_period, 1)
  on conflict (period)
    do update set last_seq = invoice_counters.last_seq + 1
  returning last_seq into v_seq;

  return v_period || '-' || lpad(v_seq::text, 2, '0');
end;
$$;

-- Assign the monthly number whenever an order comes in without one, or with
-- an old-style INV-###### number (which charge_order still generates from the
-- legacy sequence -- harmless, we just overwrite it here).
create or replace function public.orders_assign_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null or new.invoice_number ~ '^INV-[0-9]+$' then
    new.invoice_number := public.next_invoice_number();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_assign_invoice_number on orders;
create trigger orders_assign_invoice_number
  before insert on orders
  for each row
  execute function public.orders_assign_invoice_number();
