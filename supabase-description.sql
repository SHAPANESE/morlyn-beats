-- Only for projects that already ran the earlier supabase-setup.sql.
begin;
alter table public.portfolio_works
  add column if not exists description text not null default '';
alter table public.portfolio_works
  drop constraint if exists portfolio_works_description_check;
alter table public.portfolio_works
  add constraint portfolio_works_description_check check (char_length(description) <= 5000);
commit;
