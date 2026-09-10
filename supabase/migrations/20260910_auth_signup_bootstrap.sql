-- Auth signup bootstrap
-- ---------------------------------------------------------------------------
-- Creates the per-user rows in tbl_user_profiles / tbl_user_goals /
-- tbl_user_memory whenever a new auth.users row appears, and adds the RLS
-- policies that let a signed-in user read and update their own rows.
--
-- Assumes every `account_key` column is uuid, matching auth.users.id and
-- auth.uid() directly — no casts needed on either side of a comparison.
--
-- Safe to run more than once: the function is CREATE OR REPLACE, the trigger is
-- dropped first, and the policies are only created when missing.
-- ---------------------------------------------------------------------------

-- 1. Bootstrap function -----------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tbl_user_profiles (account_key, display_name, email)
  select new.id,
         nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
         new.email
  where not exists (
    select 1 from public.tbl_user_profiles p
    where p.account_key = new.id
  );

  -- tbl_user_goals has two identity columns (user_goals_id, id); specify
  -- neither and let both generate.
  insert into public.tbl_user_goals (account_key)
  select new.id
  where not exists (
    select 1 from public.tbl_user_goals g
    where g.account_key = new.id
  );

  insert into public.tbl_user_memory (account_key)
  select new.id
  where not exists (
    select 1 from public.tbl_user_memory m
    where m.account_key = new.id
  );

  return new;
end;
$$;

-- The function runs as its owner, so nobody else needs execute on it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 2. Trigger ----------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. RLS policies -----------------------------------------------------------
-- Only created when a policy of that name is not already present, so existing
-- hand-written policies are left untouched.
do $$
declare
  t text;
begin
  foreach t in array array['tbl_user_profiles', 'tbl_user_goals', 'tbl_user_memory']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = t || '_select_own'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (account_key = auth.uid())',
        t || '_select_own', t
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = t || '_update_own'
    ) then
      execute format(
        'create policy %I on public.%I for update to authenticated using (account_key = auth.uid()) with check (account_key = auth.uid())',
        t || '_update_own', t
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = t || '_insert_own'
    ) then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (account_key = auth.uid())',
        t || '_insert_own', t
      );
    end if;
  end loop;
end;
$$;

-- 4. Backfill for users that signed up before this trigger existed ----------
insert into public.tbl_user_profiles (account_key, display_name, email)
select u.id,
       nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
       u.email
from auth.users u
where not exists (
  select 1 from public.tbl_user_profiles p where p.account_key = u.id
);

insert into public.tbl_user_goals (account_key)
select u.id
from auth.users u
where not exists (
  select 1 from public.tbl_user_goals g where g.account_key = u.id
);

insert into public.tbl_user_memory (account_key)
select u.id
from auth.users u
where not exists (
  select 1 from public.tbl_user_memory m where m.account_key = u.id
);
