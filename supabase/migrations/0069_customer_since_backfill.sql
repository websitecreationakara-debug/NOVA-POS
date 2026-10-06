-- Customers added at checkout used to be saved without a "customer since" date
-- (the checkout now sets it). Give the ones already saved their creation day, so
-- the CRM list's "Customer since" filter and the CRM Charts "New customers" card
-- count the same customers.
update customers
set customer_since = (created_at at time zone 'Asia/Phnom_Penh')::date
where customer_since is null;
