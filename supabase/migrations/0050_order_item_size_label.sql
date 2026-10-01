-- A custom size sold on an order line -- e.g. "100g" of a 350g / 1kg pack.
-- The line's quantity then holds the fraction of the pack sold (0.29), so
-- stock moves by the weight actually sold; this label is just what the invoice
-- and order page show next to the product. null = a normal, full-size line.
alter table order_items add column size_label text;
