-- Who last edited an invoice (Orders > open an order > Save). orders.created_by already records who
-- created it; the order page shows both names, or just one when it is the same person.
alter table orders add column if not exists updated_by uuid references profiles (id) on delete set null;
