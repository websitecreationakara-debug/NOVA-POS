-- Deny-by-default RLS: no policies means anon/authenticated get nothing.
-- App reads/writes go through the server-side secret-key client (bypasses RLS)
-- until Phase 6 builds real per-role policies.

alter table public.brands enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.stock_levels enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.promotions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
