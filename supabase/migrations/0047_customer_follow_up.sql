-- The customer CSV (AppSheet export) has a "Follow-Up" column with no home
-- in the customers table. Plain text so it can hold whatever the sheet uses
-- (a date, a yes/no, a short note) without being rejected on import.
alter table customers add column if not exists follow_up text;
