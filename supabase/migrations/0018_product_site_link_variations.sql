-- Phase 8: let a "variable" (multi-size) website product link more than one
-- POS product to the same parent site_product_id -- one per variation --
-- instead of collapsing all sizes into a single, price/stock-less POS
-- product. See src/app/(app)/sales/SalesWebsiteGrid.tsx.

alter table product_site_links
  add column variation_id text not null default '';

alter table product_site_links
  drop constraint product_site_links_site_site_product_id_key;

alter table product_site_links
  add constraint product_site_links_site_site_product_id_variation_id_key
  unique (site, site_product_id, variation_id);

comment on column product_site_links.variation_id is
  'Empty string for a simple (non-variable) site product. For a "variable" site product with size/flavor variations, holds that variation''s own id, so each variation links to its own POS product under the same parent site_product_id.';
