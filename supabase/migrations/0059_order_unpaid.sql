-- "Unpaid" flag for an order the customer hasn't paid yet. A separate flag (not
-- a change to payment_method / status) so the order keeps counting everywhere it
-- already does and "Mark as paid" simply clears it again.
alter table orders add column if not exists is_unpaid boolean not null default false;
