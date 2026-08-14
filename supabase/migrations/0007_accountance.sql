-- Phase 4: Accountance role -- daily cash/bank-QR reconciliation and an
-- expense log. Both are per brand, per day.

create table expenses (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  description text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  category text,
  expense_date date not null default current_date,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index expenses_brand_id_date_idx on expenses (brand_id, expense_date);

-- expected_* are a snapshot of orders totals taken at reconciliation time --
-- orders can still be voided/edited later, so this preserves what was true
-- when the accountant actually closed out the day.
create table cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  reconciliation_date date not null,
  expected_cash numeric(12, 2) not null,
  expected_bank_qr numeric(12, 2) not null,
  counted_cash numeric(12, 2) not null,
  variance numeric(12, 2) not null,
  notes text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (brand_id, reconciliation_date)
);

alter table public.expenses enable row level security;
alter table public.cash_reconciliations enable row level security;
