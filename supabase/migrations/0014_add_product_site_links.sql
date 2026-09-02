-- Phase 7: maps a POS product to its counterpart on a live storefront
-- (Bosba Premium Foods / BOSBA Drink&Snack / SORA SAKE), used for two-way
-- stock sync. Applied directly against the remote project when this feature
-- shipped; this file backfills the local migration history to match.
create table if not exists product_site_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  site text not null check (site in ('bosba-premium-foods', 'bosba-drink-snack', 'sora-sake')),
  site_product_id text not null,
  matched_name text,
  match_confidence text not null default 'exact' check (match_confidence in ('exact', 'loose')),
  created_at timestamptz not null default now(),
  unique (product_id, site),
  unique (site, site_product_id)
);

comment on table product_site_links is 'Maps a POS products.id to the corresponding product row in each storefront''s own Cloudflare D1 database, used for stock sync (Phase 7).';
