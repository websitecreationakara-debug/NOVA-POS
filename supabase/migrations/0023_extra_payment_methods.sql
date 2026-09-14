-- New bookkeeping-only payment method categories for checkout/reporting
-- (Accountance's payment method breakdown) -- no gateway integration, just
-- more specific labels than the old cash/bank_qr split. Each ADD VALUE is
-- its own statement -- Postgres doesn't allow using a new enum value in the
-- same transaction that adds it, so this migration only adds values.
alter type payment_method add value 'aba_pay';
alter type payment_method add value 'wing';
alter type payment_method add value 'khqr';
alter type payment_method add value 'card';
