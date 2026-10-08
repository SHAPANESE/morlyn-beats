-- Run once in the Supabase SQL editor for this project.
begin;
create table public.portfolio_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.portfolio_admins enable row level security;
revoke all on public.portfolio_admins from anon, authenticated;

create function public.is_portfolio_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from public.portfolio_admins where user_id = (select auth.uid())); $$;
revoke all on function public.is_portfolio_admin() from public;
grant execute on function public.is_portfolio_admin() to authenticated;

create table public.portfolio_works (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('01', '02', '03', '04')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  media_type text not null check (media_type in ('image', 'video')),
  media_path text not null unique check (split_part(media_path, '/', 1) = channel),
  created_at timestamptz not null default now()
);
create index portfolio_works_channel_date on public.portfolio_works (channel, created_at desc);
alter table public.portfolio_works enable row level security;
revoke all on public.portfolio_works from anon, authenticated;
grant select on public.portfolio_works to anon, authenticated;
grant insert on public.portfolio_works to authenticated;
create policy "Visitors see published works" on public.portfolio_works for select to anon, authenticated using (true);
create policy "Admins publish works" on public.portfolio_works for insert to authenticated with check ((select public.is_portfolio_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio', 'portfolio', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
create policy "Admins upload portfolio media" on storage.objects for insert to authenticated
with check (bucket_id = 'portfolio' and (select public.is_portfolio_admin()) and (storage.foldername(name))[1] in ('01','02','03','04'));
create policy "Admins read portfolio objects" on storage.objects for select to authenticated
using (bucket_id = 'portfolio' and (select public.is_portfolio_admin()));
create policy "Admins clean unpublished media" on storage.objects for delete to authenticated
using (bucket_id = 'portfolio' and (select public.is_portfolio_admin()) and not exists (select 1 from public.portfolio_works where media_path = name));
commit;

-- After creating the client user in Authentication > Users, authorize their ID:
-- insert into public.portfolio_admins (user_id) values ('CLIENT-USER-UUID');
