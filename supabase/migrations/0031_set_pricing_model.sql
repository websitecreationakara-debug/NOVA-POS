-- Full pricing/margin model for a Set (mirrors the user's existing pricing
-- spreadsheet -- see costControl.ts for the derived-field formulas: After
-- MU$, Cost/Purchase, Total Cost, Recommend, Sale Price, %Off, Mark Up%,
-- Gross Profit, Profit Status). Set Cost itself is NOT stored here -- it's
-- still the existing computed sum of set_items (see computeSetTotalCost).
-- These four are the only manually-entered pricing inputs; everything else
-- in the model derives from them plus Set Cost.
alter table sets
  add column target_markup_pct numeric(5, 2),
  add column labor_cost numeric(12, 2),
  add column competitor_name text,
  add column competitor_base_price numeric(12, 2);

comment on column sets.target_markup_pct is
  'Target markup % applied to Set Cost to get After MU$ (e.g. 25 = 25%). null = not set.';
comment on column sets.labor_cost is
  'Manually-entered labor cost added on top of Set Cost + Cost/Purchase to get Total Cost.';
comment on column sets.competitor_name is
  'Optional note on which competitor this set''s pricing was benchmarked against.';
comment on column sets.competitor_base_price is
  'Base Price: the seller''s own price for this set (not the competitor''s) -- drives Cost/Purchase, Sale Price, %Off, Mark Up%, Gross Profit, and Profit Status.';
