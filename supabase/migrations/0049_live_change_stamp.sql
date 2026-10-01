-- A single cheap "did anything in the database change" stamp for the live
-- watcher (LiveOrdersWatcher). Postgres already counts every insert/update/
-- delete per table, so summing those counters changes whenever *any* write
-- lands -- from this app, the website order sync, or an RPC -- without
-- needing an updated_at column on every table or a query per table.
create or replace function live_change_stamp()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    string_agg(relname || ':' || (n_tup_ins + n_tup_upd + n_tup_del), '|' order by relname),
    ''
  )
  from pg_stat_user_tables
  where schemaname = 'public';
$$;

revoke execute on function live_change_stamp() from public, anon, authenticated;
grant execute on function live_change_stamp() to service_role;
