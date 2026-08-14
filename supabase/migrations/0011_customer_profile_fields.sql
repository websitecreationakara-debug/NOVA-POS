-- Online-sale customers need a real profile, not a mart POS's optional
-- name/phone -- these columns mirror the fields already tracked in the
-- AppSheet customer sheet being migrated away from (bulk import comes in
-- a later migration once the export is ready). The Sales checkout form
-- itself stays lean (phone + name only); the rest fill in over time via
-- a future customer-editing screen.
alter table customers add column second_phone text;
alter table customers add column photo_url text;
alter table customers add column address text;
alter table customers add column customer_since date;
alter table customers add column first_name text;
alter table customers add column last_name text;
alter table customers add column page_uid text;
alter table customers add column source text;
alter table customers add column label text;
alter table customers add column capital text;
alter table customers add column state text;
alter table customers add column dob date;
alter table customers add column yob int;
alter table customers add column age int;
alter table customers add column gender text;
alter table customers add column nationality text;

-- Phone is how staff identify a returning customer at checkout -- one
-- phone number must resolve to exactly one customer record.
create unique index customers_phone_key on customers (phone) where phone is not null;
