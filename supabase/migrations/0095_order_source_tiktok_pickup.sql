-- Two more ways a POS order is placed: TikTok and Pick up (migration 0037 allowed in_store, telegram, meta).
alter table orders drop constraint if exists orders_order_source_check;
alter table orders
  add constraint orders_order_source_check
    check (order_source in ('in_store', 'telegram', 'meta', 'tiktok', 'pickup'));

comment on column orders.order_source is
  'How a POS order was placed: in_store, telegram, meta, tiktok, or pickup. Shown as Order Channel on the invoice for channel=pos orders.';
