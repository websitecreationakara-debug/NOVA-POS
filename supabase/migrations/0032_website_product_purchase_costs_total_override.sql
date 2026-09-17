-- Lets Stock > Website product table's Total column be entered directly,
-- even when Original Cost / Total Cost 10% aren't filled in yet (they're
-- often missing for some products) -- see derivePurchaseCost in
-- purchaseCosts.ts.
alter table website_product_purchase_costs
  add column total_override numeric(12, 2);

comment on column website_product_purchase_costs.total_override is
  'Manual override for Total -- when set, wins over the derived Purchase Cost + Extra Money and works standalone (Original Cost / Total Cost 10% don''t need to be filled in). null = not overridden, falls back to the derived value.';
