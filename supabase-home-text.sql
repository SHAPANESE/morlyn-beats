-- Run once in Supabase SQL Editor. Safe to rerun; existing text is preserved.
begin;
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
