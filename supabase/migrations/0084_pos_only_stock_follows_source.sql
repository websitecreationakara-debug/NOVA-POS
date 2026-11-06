-- A POS-only product (products.pos_only, migration 0083) can take its stock from a website
-- product -- or, for a product with sizes, from all of its sizes added together. From then on
-- the two stay in step whatever changes either of them:
--   * a sale / cancel / order edit / restock of the POS-only product moves the source's stock
--     the same amount (taken from the sizes in order, the rest going negative on the last one
--     like any oversold product), and the POS-only product shows the sources' new total;
--   * any change to a source's stock (a website order, a stock edit, ...) updates the stock of
--     every POS-only product following it.
-- This is done in the database so every path that moves stock is covered, not just the pages.
alter table public.products
  add column if not exists stock_source_ids uuid[],
  add column if not exists stock_source_name text;

create index if not exists products_stock_source_ids_idx on public.products using gin (stock_source_ids);

create or replace function public.pos_only_stock_follow() returns trigger
language plpgsql
as $$
declare
  v_delta numeric := new.quantity - old.quantity;
  v_ids uuid[];
  v_id uuid;
  v_have numeric;
  v_take numeric;
  v_remaining numeric;
  v_last uuid;
begin
  if v_delta = 0 then
    return null;
  end if;

  -- (1) the stock of a POS-only product that follows a source changed: pass the change on.
  select p.stock_source_ids into v_ids
    from public.products p
   where p.id = new.product_id and p.pos_only and p.stock_source_ids is not null;
  if v_ids is not null and cardinality(v_ids) > 0 then
    if v_delta < 0 then
      v_remaining := -v_delta;
      foreach v_id in array v_ids loop
        select quantity into v_have from public.stock_levels where product_id = v_id for update;
        if not found then
          continue;
        end if;
        v_last := v_id;
        v_take := least(greatest(v_have, 0), v_remaining);
        if v_take > 0 then
          update public.stock_levels
             set quantity = quantity - v_take, updated_at = now()
           where product_id = v_id;
          v_remaining := v_remaining - v_take;
        end if;
        exit when v_remaining <= 0;
      end loop;
      if v_remaining > 0 and v_last is not null then
        update public.stock_levels
           set quantity = quantity - v_remaining, updated_at = now()
         where product_id = v_last;
      end if;
    else
      update public.stock_levels
         set quantity = quantity + v_delta, updated_at = now()
       where product_id = v_ids[1];
    end if;
    -- the POS-only product always shows exactly what the sources now add up to
    update public.stock_levels
       set quantity = (select coalesce(sum(x.quantity), 0) from public.stock_levels x where x.product_id = any (v_ids)),
           updated_at = now()
     where product_id = new.product_id;
    return null;
  end if;

  -- (2) the stock of a source changed: every POS-only product following it takes the new total.
  update public.stock_levels s
     set quantity = (
           select coalesce(sum(x.quantity), 0) from public.stock_levels x where x.product_id = any (p.stock_source_ids)
         ),
         updated_at = now()
    from public.products p
   where p.pos_only
     and p.stock_source_ids @> array[new.product_id]
     and s.product_id = p.id;
  return null;
end;
$$;

-- Only for changes made by a statement of its own: the updates this function makes on other
-- stock_levels rows must not start it again (pg_trigger_depth() is 0 only for those).
drop trigger if exists stock_levels_pos_only_follow on public.stock_levels;
create trigger stock_levels_pos_only_follow
  after update of quantity on public.stock_levels
  for each row
  when (pg_trigger_depth() = 0 and old.quantity is distinct from new.quantity)
  execute function public.pos_only_stock_follow();

-- Starts following: the POS-only product takes the sources' total now (without moving the
-- sources) and from then on follows them.
create or replace function public.link_pos_only_stock(p_product_id uuid, p_source_ids uuid[], p_name text)
returns numeric
language plpgsql
as $$
declare
  v_total numeric;
begin
  -- unlinked while its number is set, so setting it does not move the sources
  update public.products set stock_source_ids = null, stock_source_name = null where id = p_product_id and pos_only;
  select coalesce(sum(quantity), 0) into v_total from public.stock_levels where product_id = any (p_source_ids);
  insert into public.stock_levels (product_id, quantity)
  values (p_product_id, v_total)
  on conflict (product_id) do update set quantity = excluded.quantity, updated_at = now();
  update public.products set stock_source_ids = p_source_ids, stock_source_name = p_name where id = p_product_id and pos_only;
  return v_total;
end;
$$;

revoke execute on function public.link_pos_only_stock(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.link_pos_only_stock(uuid, uuid[], text) to service_role;
