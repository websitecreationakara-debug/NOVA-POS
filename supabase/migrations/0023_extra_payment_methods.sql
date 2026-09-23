-- KHQR is the second checkout payment method alongside cash (see
-- CHECKOUT_PAYMENT_METHODS) -- bookkeeping-only, set manually at checkout
-- and shown as-is on the invoice, no gateway integration.
alter type payment_method add value 'khqr';
