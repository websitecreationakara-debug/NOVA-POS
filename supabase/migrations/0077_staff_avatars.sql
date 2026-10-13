-- Profile photos for staff accounts (Users page). Photos live in a public bucket
-- so <img> tags can hit the object URL directly; writes only ever happen through
-- the service-role client (supabaseAdmin), same as the product-images bucket
-- (0010), so no storage.objects RLS policies are needed.
alter table profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-avatars', 'staff-avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
