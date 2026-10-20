-- A POS-only product that is "not counted" (products.stock_untracked, migration 0085 -- it
-- follows a website product that shows "—") must stay not counted: a sale still records the
-- amount on the order, but no longer pushes the product's stock down to -1, -2, ...
-- This is done where the stock is written so every path that moves stock is covered
-- (sales, order edits, cancels, stock edits).
alter table public.products
  add column if not exists stock_untracked boolean not null default false;

create or replace function public.pos_only_untracked_keep() returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.products p
     where p.id = new.product_id and p.pos_only and p.stock_untracked
  ) then
    new.quantity := old.quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_levels_pos_only_untracked on public.stock_levels;
create trigger stock_levels_pos_only_untracked
  before update of quantity on public.stock_levels
  for each row
  when (old.quantity is distinct from new.quantity)
  execute function public.pos_only_untracked_keep();

-- Following a counted product again: counted from now on (and its number can be set).
create or replace function public.link_pos_only_stock(p_product_id uuid, p_source_ids uuid[], p_name text)
returns numeric
language plpgsql
as $$
declare
  v_total numeric;
begin
  -- unlinked and counted while its number is set, so setting it does not move the sources
  update public.products
     set stock_source_ids = null, stock_source_name = null, stock_untracked = false
   where id = p_product_id and pos_only;
  select coalesce(sum(quantity), 0) into v_total from public.stock_levels where product_id = any (p_source_ids);
  insert into public.stock_levels (product_id, quantity)
  values (p_product_id, v_total)
  on conflict (product_id) do update set quantity = excluded.quantity, updated_at = now();
  update public.products set stock_source_ids = p_source_ids, stock_source_name = p_name where id = p_product_id and pos_only;
  return v_total;
end;
$$;

-- Following a product that is not counted: this one is not counted either, and its stored
-- number is reset to 0 (it may have gone negative before).
create or replace function public.set_pos_only_untracked(p_product_id uuid, p_name text)
returns void
language plpgsql
as $$
begin
  update public.products
     set stock_source_ids = null, stock_untracked = false
   where id = p_product_id and pos_only;
  update public.stock_levels set quantity = 0, updated_at = now() where product_id = p_product_id;
  update public.products
     set stock_untracked = true, stock_source_name = p_name
   where id = p_product_id and pos_only;
end;
$$;

revoke execute on function public.link_pos_only_stock(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.link_pos_only_stock(uuid, uuid[], text) to service_role;
revoke execute on function public.set_pos_only_untracked(uuid, text) from public, anon, authenticated;
grant execute on function public.set_pos_only_untracked(uuid, text) to service_role;
