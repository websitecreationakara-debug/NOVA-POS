-- Customers often order today but want the goods a day or two later, at a
-- particular time of day. This is when the customer asked to receive the
-- order (date + time); null means "as soon as possible / same day". It's set
-- right after charge_order() creates the row (see chargeOrder in
-- src/app/(app)/sales/actions.ts), so the RPC itself doesn't need to change.

alter table orders add column delivery_at timestamptz;

comment on column orders.delivery_at is
  'Customer-requested delivery date & time; null = ASAP / same day.';
