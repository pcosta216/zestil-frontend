-- Default collections on profile creation
-- ---------------------------------------------------------------------------
-- Gives every new account the starter set of recipe collections (Main,
-- Breakfast, Chicken, ...) the moment its tbl_user_profiles row appears, by
-- copying every row of tbl_collections_header_user_default into
-- tbl_collections_set_header for that account_key.
--
-- Chains off the signup bootstrap in 20260910_auth_signup_bootstrap.sql:
--
--   auth.users insert
--     -> on_auth_user_created            (trigger on auth.users)
--        -> handle_new_user()             security definer
--           -> insert tbl_user_profiles
--              -> trg_user_profiles_insert_collections   (this file)
--                 -> fn_insert_default_collections()
--                    -> insert tbl_collections_set_header  x11
--
-- This closes a real gap rather than adding a nicety: nothing in the frontend
-- has ever created a tbl_collections_set_header row (only reads, via
-- getCollections in lib/supabase/queries.ts), so an account with no collections
-- had nowhere to put a saved recipe and the Saved tab's Add flow could not
-- complete. See docs/app/saved_tab/saved_tab.md.
--
-- Reproduces what is already deployed (created by hand 2026-09-30), so running
-- this changes nothing on the current database — it exists so a rebuild from
-- migrations produces the same schema. Re-runnable: the function is CREATE OR
-- REPLACE and the trigger is dropped first.
--
-- Note on tbl_collections_header_user_default: its primary key column is named
-- `id` but holds the collection's display TEXT ("Main", "Salad", ...), which is
-- why `select id` is the right thing to copy into collections_short_desc.
-- `status` is left to the column default (1710) — the value getCollections
-- filters on, so a row inserted without it is visible to the app.
-- ---------------------------------------------------------------------------

-- 1. Trigger function -------------------------------------------------------
create or replace function public.fn_insert_default_collections()
returns trigger
language plpgsql
as $$
begin
    insert into tbl_collections_set_header (collections_short_desc, account_key)
    select id, new.account_key
    from tbl_collections_header_user_default;

    return new;
end;
$$;

-- 2. Trigger ----------------------------------------------------------------
drop trigger if exists trg_user_profiles_insert_collections on public.tbl_user_profiles;

create trigger trg_user_profiles_insert_collections
  after insert on public.tbl_user_profiles
  for each row execute function public.fn_insert_default_collections();

-- ---------------------------------------------------------------------------
-- Known limitations — deliberate, or at least known. None of these bite on the
-- signup path as it exists today; each is written down because the thing that
-- makes it harmless is elsewhere in the system and could change.
--
-- a) NOT security definer, and tbl_collections_header_user_default is not
--    readable by `authenticated`. Verified 2026-09-30: signed in as a normal
--    user, that table returns 0 of its 11 rows, while tbl_collections_set_header
--    correctly returns only that user's own rows. The function therefore only
--    works because its sole caller today is handle_new_user(), which IS security
--    definer, so this nested trigger inherits those privileges.
--
--    tbl_user_profiles has a tbl_user_profiles_insert_own policy, so a signed-in
--    user CAN insert their own profile row directly. Nothing does today (the app
--    only ever reads that table — grepped app/ and lib/), but if anything ever
--    did, this function would run as `authenticated`, the SELECT would return
--    zero rows, and the user would silently get no collections. No error, no log
--    — just an empty Saved tab.
--
--    Fix, if that ever becomes reachable: add `security definer` and
--    `set search_path = ''` and schema-qualify both table names, matching
--    handle_new_user() exactly.
--
-- b) Mutable search_path. handle_new_user() pins `set search_path = ''` and
--    fully qualifies its tables; this one resolves `tbl_collections_set_header`
--    and `tbl_collections_header_user_default` against whatever search_path the
--    caller has. Supabase's own linter flags this pattern. Same fix as (a).
--
-- c) No guard against a second insert. handle_new_user() wraps each of its three
--    inserts in `where not exists`; this one does not, so a profile row inserted
--    twice for the same account_key would hand that account a second set of 11
--    collections. Not reachable through signup (one profile row per auth user),
--    but it is the kind of thing a backfill or a manual fix-up could trip.
--
-- d) No backfill. Accounts created before 2026-09-30 keep whatever collections
--    they already had, including none — me@gmail.com has zero. Matching the
--    deliberate choice in 20260910_auth_signup_bootstrap.sql §4 not to mass-
--    modify existing test accounts. The backfill, if wanted later:
--
--      insert into tbl_collections_set_header (collections_short_desc, account_key)
--      select d.id, p.account_key
--      from tbl_user_profiles p
--      cross join tbl_collections_header_user_default d
--      where not exists (
--        select 1 from tbl_collections_set_header c
--        where c.account_key = p.account_key
--      );
--
--    Scoped to accounts with NO collections at all, so it can't double up on an
--    account that already has some (see (c)).
-- ---------------------------------------------------------------------------
