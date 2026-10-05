-- An expense can now belong to "All Businesses" instead of one business: the
-- Expense & Accounts Payable tab logs against every business at once. brand_id
-- NULL means that. Such an expense shows in the All Businesses views and totals;
-- a view of one single business only counts that business's own expenses, so
-- nothing is ever counted twice. Existing expenses keep their business.
alter table public.expenses alter column brand_id drop not null;

comment on column public.expenses.brand_id is
  'The business the expense belongs to; NULL = All Businesses (shared).';
