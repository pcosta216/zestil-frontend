# Auth setup

Covers sign-in, sign-up, password recovery and password reset. Code lives in
`app/(auth)/`, `app/auth/confirm/route.ts`, `app/onboarding/`, and `proxy.ts`.

## 1. Run the migration

`supabase/migrations/20260910_auth_signup_bootstrap.sql` in the SQL editor. It:

- adds `public.handle_new_user()` + the `on_auth_user_created` trigger on
  `auth.users`, which seeds `tbl_user_profiles` (account_key, display_name,
  email), `tbl_user_goals` (account_key) and `tbl_user_memory` (account_key)
- adds `select` / `insert` / `update` RLS policies scoped to
  `account_key = auth.uid()` on those three tables, skipping any policy name
  that already exists
- backfills rows for auth users that predate the trigger

Re-runnable. It assumes every `account_key` column is uuid, matching
`auth.users.id` and `auth.uid()` with no cast on either side.

`display_name` reaches the trigger through `raw_user_meta_data`, set by
`signUp({ options: { data: { display_name } } })` in `SignupForm.tsx`.

## 2. Dashboard settings

**Authentication → Providers → Email**

- *Confirm email*: **off** for now, **on** in production.

**Authentication → URL Configuration**

- Site URL: `http://localhost:3000` in dev, the production domain in prod.
- Redirect URLs — add both:
  - `http://localhost:3000/auth/confirm`
  - `https://<production-domain>/auth/confirm`

**Authentication → Email Templates**

`/auth/confirm` accepts both the `token_hash` and the stock `code` link shape,
so the default templates work as-is. The `token_hash` form is preferred — it
doesn't depend on a PKCE verifier cookie surviving in the browser:

*Confirm signup*

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">
  Confirm your email
</a>
```

*Reset password*

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">
  Reset your password
</a>
```

The `next` parameter is validated in `lib/auth.ts` — only same-origin paths
pass, so these links can't be rewritten into an off-site redirect.

## 3. Email sending

No custom SMTP is configured, so the built-in mailer's few-per-hour limit
applies. A 429 is surfaced to the user with that explanation
(`describeAuthError` in `lib/auth.ts`). Configure SMTP before launch.

## Routes

| Route | Access | Notes |
| --- | --- | --- |
| `/login` | guest | Signed-in users bounce to `/zestil` |
| `/signup` | guest | Display name, email, password + confirm |
| `/forgot-password` | guest | Sends the recovery email |
| `/reset-password` | **authenticated** | A recovery link signs the user in first, so this must stay reachable while authenticated |
| `/auth/confirm` | public | Not in the proxy matcher — it sets session cookies itself |
| `/onboarding` | authenticated | Placeholder; Skip goes to `/zestil` |

After a successful reset, `signOut({ scope: "others" })` revokes every other
session for the account and keeps the current one.

## Deliberate behaviours

- **Signup with an existing email** says "That email is already registered."
  With confirmations on, Supabase returns a decoy user instead of an error, so
  the check is `data.user.identities?.length === 0`.
- **Forgot password** stays neutral ("if an account exists…") — Supabase never
  reveals whether the address is registered, and neither does the copy.
- **Password rules** are Supabase's default 6-character minimum, enforced
  client-side too so the confirm-password mismatch surfaces first.

## Not covered — account settings, later

Email change, changing a password while signed in, delete account, and the
`terms_and_conditions` / `terms_and_conditions_id` columns on
`tbl_user_profiles`.
