-- Storage bucket for product photos uploaded from the Stock page. Public
-- read so <img> tags can hit the object URL directly; writes only ever
-- happen through the service-role client (supabaseAdmin), same as every
-- other mutation in this app, so no storage.objects RLS policies are needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
