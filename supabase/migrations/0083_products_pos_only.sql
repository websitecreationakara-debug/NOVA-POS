-- Products that are sold only at the POS and never listed on the storefront
-- website (a drink bought in for the shop, a bag, ...). Created from the Stock
-- page's "+ POS-only product" button. The flag tells them apart from the other
-- POS products that have no website link (old test items, ingredients, items
-- taken off the site), which must not show up in the Sales grid.
alter table public.products
  add column if not exists pos_only boolean not null default false;
