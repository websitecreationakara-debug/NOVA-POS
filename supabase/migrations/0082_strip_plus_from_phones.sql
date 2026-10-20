-- Website orders used to save phone numbers as "+85510621788"; the POS and the
-- customer list keep them as "85510621788". The order-sync route now strips the
-- "+", this does the same for rows already saved.
update public.orders
   set customer_phone = substr(btrim(customer_phone), 2)
 where btrim(customer_phone) like '+%';

-- customers.phone is unique, so a "+855..." customer is skipped when the plain
-- "855..." number already belongs to another customer (those need merging by hand).
update public.customers c
   set phone = substr(btrim(c.phone), 2)
 where btrim(c.phone) like '+%'
   and not exists (
     select 1 from public.customers o
      where o.id <> c.id and o.phone = substr(btrim(c.phone), 2)
   );

update public.customers
   set second_phone = substr(btrim(second_phone), 2)
 where btrim(second_phone) like '+%';

-- Same for numbers saved with the local leading 0 ("085251742" -> "85585251742").
update public.orders
   set customer_phone = '855' || substr(btrim(customer_phone), 2)
 where btrim(customer_phone) ~ '^0[1-9][0-9]{7,8}$';

update public.customers c
   set phone = '855' || substr(btrim(c.phone), 2)
 where btrim(c.phone) ~ '^0[1-9][0-9]{7,8}$'
   and not exists (
     select 1 from public.customers o
      where o.id <> c.id and o.phone = '855' || substr(btrim(c.phone), 2)
   );

update public.customers
   set second_phone = '855' || substr(btrim(second_phone), 2)
 where btrim(second_phone) ~ '^0[1-9][0-9]{7,8}$';
