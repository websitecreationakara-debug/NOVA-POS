-- Marketing > Cost Control: a Set switched to "active" gets a real sellable
-- product created for it (shows up in Stock, and pushed to the website as a
-- draft listing for review) -- see activateSetListing/deactivateSetListing
-- in costControlActions.ts. This column remembers which `products` row is
-- that Set's own listing, so re-activating (or deactivating) an
-- already-synced Set updates the same row instead of creating a duplicate
-- each time.
alter table sets add column linked_product_id uuid references products(id) on delete set null;
