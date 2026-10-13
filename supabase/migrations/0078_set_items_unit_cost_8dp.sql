-- A per-gram Set line cost rounded to 4 places drifts from the product's Total in
-- Stock once it's multiplied back up: $100.09/kg is $0.1001/g, so 1000g added up to
-- $100.10. Widen unit_cost to 8 decimal places so g and kg lines match Stock exactly.
-- Lines are re-priced to the finer figure the next time their set is opened.
alter table set_items alter column unit_cost type numeric(12, 8);
