-- The Profile tab's biometrics editor (app/api/profile/route.ts) writes through this function:
-- profile.locale.units and profile.biometrics.{gender,age,height,weight} of the signed-in user's
-- memory_json, and nothing else in it. The row is locked from the read to the write, so an agent
-- writing another part of memory_json at the same moment (diet_search during a recipe search)
-- is never overwritten, which a read-modify-write from the route could do.
--
-- Validation is the route's (the same validateBiometrics the onboarding form runs); this only
-- writes. Security invoker, so the own-row RLS policies apply, and the row is always
-- auth.uid()'s: the account is never a parameter.

create or replace function public.update_memory_biometrics(
  p_units  text,
  p_gender text,
  p_age    numeric,
  p_height numeric,
  p_weight numeric
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_memory     jsonb;
  v_profile    jsonb;
  v_biometrics jsonb;
  v_locale     jsonb;
begin
  select memory_json into v_memory
    from public.tbl_user_memory
   where account_key = auth.uid()
     for update;
  if not found then
    raise exception 'update_memory_biometrics: no tbl_user_memory row for this user';
  end if;

  -- A row still at its column default may not have these levels as objects yet.
  if jsonb_typeof(v_memory) is distinct from 'object' then v_memory := '{}'::jsonb; end if;
  v_profile := case when jsonb_typeof(v_memory -> 'profile') = 'object' then v_memory -> 'profile' else '{}'::jsonb end;
  v_biometrics := case when jsonb_typeof(v_profile -> 'biometrics') = 'object' then v_profile -> 'biometrics' else '{}'::jsonb end;
  v_locale := case when jsonb_typeof(v_profile -> 'locale') = 'object' then v_profile -> 'locale' else '{}'::jsonb end;

  v_biometrics := v_biometrics || jsonb_build_object('gender', p_gender, 'age', p_age, 'height', p_height, 'weight', p_weight);
  v_locale := v_locale || jsonb_build_object('units', p_units);
  v_profile := v_profile || jsonb_build_object('biometrics', v_biometrics, 'locale', v_locale);

  update public.tbl_user_memory
     set memory_json = v_memory || jsonb_build_object('profile', v_profile)
   where account_key = auth.uid();
end;
$$;

revoke execute on function public.update_memory_biometrics(text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.update_memory_biometrics(text, text, numeric, numeric, numeric) to authenticated;
