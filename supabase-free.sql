-- Supabase Free: one owner, private images, YouTube links and four channels.
-- Run in SQL Editor. Safe to rerun; existing works are preserved.
begin;
create table if not exists public.portfolio_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create unique index if not exists portfolio_single_owner on public.portfolio_admins ((true));
alter table public.portfolio_admins enable row level security;
revoke all on public.portfolio_admins from anon, authenticated;

create or replace function public.is_portfolio_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.portfolio_admins where user_id = (select auth.uid())); $$;
revoke all on function public.is_portfolio_admin() from public;
grant execute on function public.is_portfolio_admin() to authenticated;

create table if not exists public.portfolio_works (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('01', '02', '03', '04')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '',
  media_type text not null,
  media_path text unique,
  video_id text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.portfolio_works add column if not exists description text not null default '';
alter table public.portfolio_works add column if not exists video_id text;
alter table public.portfolio_works add column if not exists published boolean not null default true;
alter table public.portfolio_works alter column media_path drop not null;
alter table public.portfolio_works drop constraint if exists portfolio_works_media_type_check;
alter table public.portfolio_works drop constraint if exists portfolio_works_description_check;
alter table public.portfolio_works drop constraint if exists portfolio_works_source_check;
alter table public.portfolio_works add constraint portfolio_works_description_check check (char_length(description) <= 5000);
alter table public.portfolio_works add constraint portfolio_works_source_check check (
  (media_type in ('image', 'video') and media_path is not null and video_id is null and split_part(media_path, '/', 1) = channel)
  or (media_type = 'youtube' and media_path is null and video_id is not null and video_id ~ '^[A-Za-z0-9_-]{11}$')
);
create index if not exists portfolio_works_channel_date on public.portfolio_works (channel, created_at desc);
alter table public.portfolio_works enable row level security;
revoke all on public.portfolio_works from anon, authenticated;
grant select on public.portfolio_works to anon, authenticated;
grant insert, update, delete on public.portfolio_works to authenticated;

drop policy if exists "Visitors see published works" on public.portfolio_works;
drop policy if exists "Admins read works" on public.portfolio_works;
drop policy if exists "Admins publish works" on public.portfolio_works;
drop policy if exists "Admins edit works" on public.portfolio_works;
drop policy if exists "Admins delete works" on public.portfolio_works;
create policy "Visitors see published works" on public.portfolio_works for select to anon, authenticated using (published);
create policy "Admins read works" on public.portfolio_works for select to authenticated using ((select public.is_portfolio_admin()));
create policy "Admins publish works" on public.portfolio_works for insert to authenticated with check ((select public.is_portfolio_admin()));
create policy "Admins edit works" on public.portfolio_works for update to authenticated using ((select public.is_portfolio_admin())) with check ((select public.is_portfolio_admin()));
create policy "Admins delete works" on public.portfolio_works for delete to authenticated using ((select public.is_portfolio_admin()));

-- Private bucket; visitors can request temporary URLs only for published media.
-- Existing Storage videos remain readable; new videos use YouTube links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Admins upload portfolio media" on storage.objects;
drop policy if exists "Admins read portfolio objects" on storage.objects;
drop policy if exists "Admins clean unpublished media" on storage.objects;
drop policy if exists "Visitors read published media" on storage.objects;
drop policy if exists "Admins delete portfolio media" on storage.objects;
create policy "Admins upload portfolio media" on storage.objects for insert to authenticated
with check (bucket_id='portfolio' and (select public.is_portfolio_admin()) and (storage.foldername(name))[1] in ('01','02','03','04'));
create policy "Admins read portfolio objects" on storage.objects for select to authenticated
using (bucket_id='portfolio' and (select public.is_portfolio_admin()));
create policy "Visitors read published media" on storage.objects for select to anon, authenticated
using (bucket_id='portfolio' and exists (select 1 from public.portfolio_works w where w.media_path=storage.objects.name and w.published));
create policy "Admins delete portfolio media" on storage.objects for delete to authenticated
using (bucket_id='portfolio' and (select public.is_portfolio_admin()));

create table if not exists public.portfolio_site_content (
  id text primary key check (id = 'home'),
  body text not null default '' check (char_length(body) <= 600)
);
alter table public.portfolio_site_content enable row level security;
revoke all on public.portfolio_site_content from anon, authenticated;
grant select on public.portfolio_site_content to anon, authenticated;
grant insert, update on public.portfolio_site_content to authenticated;
drop policy if exists "Visitors read home text" on public.portfolio_site_content;
drop policy if exists "Owner edits home text" on public.portfolio_site_content;
create policy "Visitors read home text" on public.portfolio_site_content
  for select to anon, authenticated using (true);
create policy "Owner edits home text" on public.portfolio_site_content
  for all to authenticated
  using ((select public.is_portfolio_admin()))
  with check ((select public.is_portfolio_admin()));
insert into public.portfolio_site_content(id, body)
values ('home', '') on conflict (id) do nothing;
commit;

-- Create the owner in Authentication > Users, then authorize their UUID:
-- insert into public.portfolio_admins(user_id) values ('CLIENT-UUID') on conflict(user_id) do nothing;
-- Disable public signups and configure Auth redirect URLs for your Vercel domain.
