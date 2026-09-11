-- A free-text note / description for an order: special instructions, what the
-- delivery is for, anything staff want on the record. Set from the Sales
-- checkout and the order detail editor, printed under "Remarks" on the
-- invoice. Stamped on after charge_order() (like delivery_at) so the RPC
-- signature stays put.

alter table orders add column note text;

comment on column orders.note is
  'Free-text note / description for the order; shown under Remarks on the invoice.';
