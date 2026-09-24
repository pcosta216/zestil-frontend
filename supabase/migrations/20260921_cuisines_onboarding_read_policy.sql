-- n_cuisine_narrow and n_dishes read their options from tbl_cuisines_onboarding at runtime
-- (lib/onboarding/cuisines.ts), through the normal per-request RLS-scoped client — the same way
-- tbl_onboarding_content is read. Without a select policy those reads return ZERO ROWS AND NO
-- ERROR, so both screens silently render just the "Other" tile: it looks like a region with no
-- cuisines rather than a permissions problem. Read-only, authenticated only; no write policy,
-- so inserts/updates stay with the service role (Supabase Studio/SQL), matching
-- tbl_onboarding_content's arrangement until a real admin role exists.

alter table if exists public.tbl_cuisines_onboarding enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tbl_cuisines_onboarding'
      and policyname = 'tbl_cuisines_onboarding_select_authenticated'
  ) then
    execute 'create policy tbl_cuisines_onboarding_select_authenticated on public.tbl_cuisines_onboarding
             for select to authenticated using (true)';
  end if;
end;
$$;
