-- Weight-based Set lines (see costControl.ts) price by the gram -- a $31.50
-- 500g pack is $0.0630/g. numeric(12,2) truncated that to $0.06, a ~5% error
-- compounded across every gram-based line. Widen to 4 decimal places; pcs-
-- based costs (whole cents) are unaffected.
alter table set_items alter column unit_cost type numeric(12, 4);
