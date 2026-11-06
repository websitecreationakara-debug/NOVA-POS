-- A POS-only product that follows a website product whose stock is not tracked (the website
-- shows "—" for it, i.e. no stock number / unlimited) is itself not tracked: it shows "—" and
-- is never out of stock in Sales, instead of showing the POS count of that product (0 or -1).
alter table public.products
  add column if not exists stock_untracked boolean not null default false;
