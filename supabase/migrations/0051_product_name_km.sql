-- The product's name in Khmer, shown under the English name on the invoice.
-- Edited from Stock > Website Products (Edit button). null = no Khmer name.
alter table products add column name_km text;
