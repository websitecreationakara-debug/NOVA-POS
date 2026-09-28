-- How a POS ("channel"='pos') order was placed -- In-Store, Telegram, or Meta
-- (Facebook/Messenger). Only meaningful for POS orders; "online" storefront
-- orders keep showing their real site via channel/site instead. Selected at
-- the Sales checkout, printed as "Order Channel" on the invoice in place of
-- the previously hardcoded "In-Store (POS)". Stamped on after charge_order()
-- (like note/delivery_at) so the RPC signature stays put.

alter table orders
  add column order_source text not null default 'in_store'
    check (order_source in ('in_store', 'telegram', 'meta'));

comment on column orders.order_source is
  'How a POS order was placed: in_store, telegram, or meta. Shown as Order Channel on the invoice for channel=pos orders.';
