-- The product's scale (unit: pcs / kg / g) written in Khmer, shown with the
-- English unit on the invoice. Edited from Stock > Website Products (Edit
-- button). null = no Khmer scale.
alter table products add column unit_km text;
