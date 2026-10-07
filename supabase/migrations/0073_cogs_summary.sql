-- COGS / waste / promotion totals for a business and date range, counted in the
-- database. getCogsSummary used to download every sold line and every stock
-- adjustment in the range and add them up in Node (it runs twice per Accounting
-- page load: the period and the one before it).
--
-- Same rules as getCogsSummary:
--   * sold lines: paid orders in the counted fulfillment statuses, dated by
--     orders.list_at, scoped to a business by the PRODUCT's brand;
--   * lines with no recorded cogs are NOT summed here -- they come back grouped by
--     product so the app can price them from the product's current cost;
--   * an adjustment with no cost_impact falls back to the product's current price
--     x the units removed (only for a negative delta), rounded to cents.
create or replace function cogs_summary(
  p_statuses text[],
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'known_cogs', coalesce((
      select sum(oi.cogs)
      from order_items oi
      join orders o on o.id = oi.order_id
      join products p on p.id = oi.product_id
      where o.status = 'paid'
        and o.fulfillment_status::text = any (p_statuses)
        and o.list_at >= p_from and o.list_at <= p_to
        and (p_brand_id is null or p.brand_id = p_brand_id)
        and oi.cogs is not null
    ), 0),

    'uncosted_lines', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', u.product_id, 'quantity', u.quantity))
      from (
        select oi.product_id, sum(oi.quantity) as quantity
        from order_items oi
        join orders o on o.id = oi.order_id
        join products p on p.id = oi.product_id
        where o.status = 'paid'
          and o.fulfillment_status::text = any (p_statuses)
          and o.list_at >= p_from and o.list_at <= p_to
          and (p_brand_id is null or p.brand_id = p_brand_id)
          and oi.cogs is null
        group by oi.product_id
      ) u
    ), '[]'::jsonb),

    'waste_cost', coalesce((
      select sum(coalesce(sa.cost_impact, case when sa.delta < 0 then round(p.price * abs(sa.delta), 2) else 0 end))
      from stock_adjustments sa
      join products p on p.id = sa.product_id
      where sa.category = 'waste'
        and sa.created_at >= p_from and sa.created_at <= p_to
        and (p_brand_id is null or p.brand_id = p_brand_id)
    ), 0),

    'promotion_cost', coalesce((
      select sum(coalesce(sa.cost_impact, case when sa.delta < 0 then round(p.price * abs(sa.delta), 2) else 0 end))
      from stock_adjustments sa
      join products p on p.id = sa.product_id
      where sa.category = 'promotion'
        and sa.created_at >= p_from and sa.created_at <= p_to
        and (p_brand_id is null or p.brand_id = p_brand_id)
    ), 0)
  );
$$;

revoke execute on function cogs_summary(text[], uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function cogs_summary(text[], uuid, timestamptz, timestamptz) to service_role;
