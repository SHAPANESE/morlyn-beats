-- Replace cliente@example.com with the real account email before running.
-- Run after creating the account in Authentication > Users.
-- Creates no Auth account and changes no password. Safe to rerun.
begin;
do $$
declare
  owner_uuid uuid;
begin
  select id into owner_uuid from auth.users
  where lower(email) = 'cliente@example.com' and email_confirmed_at is not null;
  if owner_uuid is null then
    raise exception 'Create and confirm cliente@example.com in Authentication > Users first.';
  end if;
  insert into public.portfolio_admins(user_id)
  values (owner_uuid) on conflict(user_id) do nothing;
end $$;
commit;
