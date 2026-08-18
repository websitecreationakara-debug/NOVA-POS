-- Fulfillment status is separate from `status` (which tracks the payment/charge
-- lifecycle: open/paid/voided). This tracks where the order is in delivery,
-- so it needs its own column and enum rather than overloading the existing one.

create type fulfillment_status as enum (
  'new_order',
  'processing',
  'delivered',
  'cancelled',
  'complete'
);

alter table orders
  add column fulfillment_status fulfillment_status not null default 'new_order';
