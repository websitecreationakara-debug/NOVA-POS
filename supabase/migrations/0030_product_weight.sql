-- Lets a product record how many grams one of its own unit (e.g. one "pcs")
-- weighs -- e.g. a product sold as "1 pcs" that's actually a 500g pack.
-- Marketing > Cost Control's Set Builder uses this to let a line's Scale be
-- switched to kg/g and still price correctly (see productWeightGrams in
-- costControl.ts), for any product, not just ones with the weight spelled
-- out in their name. null (not 0) when not recorded -- kg/g stay unavailable
-- for that product until it is.
alter table products add column weight_grams numeric(12, 2);

comment on column products.weight_grams is
  'Grams one unit of this product (as sold, e.g. one "pcs") weighs. null = unknown. Used by Cost Control Set lines to convert Scale to kg/g.';
