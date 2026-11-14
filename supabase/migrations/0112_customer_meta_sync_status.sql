-- CRM "Meta Conv." column: tracks whether a customer's Purchase/Lead/Customer
-- events have actually been delivered to Meta's Conversions API, instead of
-- guessing from brand/token configuration alone.
--
-- Written by src/lib/metaConversions.ts after every send attempt:
--   'connected' -- at least one event for this customer has been accepted by Meta.
--   'failed'    -- the most recent attempt was rejected, and none has ever succeeded.
--   null        -- no order has produced a Meta send yet (e.g. brand's token isn't set).
-- A later failure never overwrites a prior 'connected', so a transient API
-- error doesn't make an already-confirmed customer look disconnected.
alter table customers
  add column if not exists meta_sync_status text,
  add column if not exists meta_synced_at timestamptz;

alter table customers
  drop constraint if exists customers_meta_sync_status_check;
alter table customers
  add constraint customers_meta_sync_status_check
  check (meta_sync_status is null or meta_sync_status in ('connected', 'failed'));
