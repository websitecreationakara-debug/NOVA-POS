## NOVA POS

Web-based POS replacing AppSheet, for online retail sale of Japanese products across
BOSBA Premium Foods, BOSBA Drink&Snack, and SORA SAKE.

### Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Supabase (Postgres + Auth)

### Roles

- **Sales** — `/sales` — checkout (category grid, cart, Cash/Bank-QR payment, receipt)
- **Stock** — `/stock` — stock levels, adjustments, low-stock alerts
- **Accountance** — `/accountance` — daily reconciliation, expense log, reports
- **Marketing** — `/marketing` — promotions, customer segments

### Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase project URL + keys
npm run dev
```

Apply the schema in `supabase/migrations/0001_init.sql` to a Supabase project
(via the SQL editor or `supabase db push`) before running the app.
