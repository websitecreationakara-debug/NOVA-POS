-- The AppSheet export imported in migration 0004 was mislabeled as
-- "BOSBA Premium Foods" only -- it actually covers all 3 brands, just not
-- split apart yet. This splits it out by category:
--   SORA SAKE: Sake, Japanese Sake, Sake Promotion, Japanese Whisky,
--     Japanese Spirit, Plum Wine & Liqueur, Sparkling Wine, Beer
--   BOSBA Drink&Snack: Beverage, Soft Drink, Dessert
--   BOSBA Premium Foods: everything else (seafood/meat/grocery)
-- Replaces each brand's remaining Phase 0 placeholder categories/products.

do $$
declare
  v_premium uuid := (select id from brands where slug = 'bosba-premium-foods');
  v_drink uuid := (select id from brands where slug = 'bosba-drink-snack');
  v_sake uuid := (select id from brands where slug = 'sora-sake');
  v_sake_cats text[] := array[
    'Sake', 'Japanese Sake', 'Sake Promotion', 'Japanese Whisky',
    'Japanese Spirit', 'Plum Wine & Liqueur', 'Sparkling Wine', 'Beer'
  ];
  v_drink_cats text[] := array['Beverage', 'Soft Drink', 'Dessert'];
begin
  delete from products where brand_id in (v_drink, v_sake);
  delete from categories where brand_id in (v_drink, v_sake);

  insert into categories (brand_id, name, sort_order)
  select v_sake, c.name, c.sort_order
  from categories c
  where c.brand_id = v_premium and c.name = any (v_sake_cats);

  insert into categories (brand_id, name, sort_order)
  select v_drink, c.name, c.sort_order
  from categories c
  where c.brand_id = v_premium and c.name = any (v_drink_cats);

  update products p
  set brand_id = v_sake, category_id = nc.id
  from categories oc, categories nc
  where p.category_id = oc.id
    and oc.brand_id = v_premium
    and oc.name = any (v_sake_cats)
    and nc.brand_id = v_sake
    and nc.name = oc.name;

  update products p
  set brand_id = v_drink, category_id = nc.id
  from categories oc, categories nc
  where p.category_id = oc.id
    and oc.brand_id = v_premium
    and oc.name = any (v_drink_cats)
    and nc.brand_id = v_drink
    and nc.name = oc.name;

  delete from categories
  where brand_id = v_premium
    and name = any (v_sake_cats || v_drink_cats);
end $$;
