# Owner-issued staff accounts

BunkIn is a single-restaurant app. Customers sign up themselves. Everyone else is issued a sign-in by the owner.

| Role | How the account exists | Can do |
|---|---|---|
| customer | public sign-up | order, track, review |
| owner | seeded once with `scripts/seed-owner.mjs` (database allows only one) | everything, including Team, settings, reports, refunds |
| manager | created by the owner (Owner → Team) | orders, menu, dashboard |
| rider | created by the owner (Owner → Team) | assigned deliveries, GPS, OTP completion |

## One-time setup

1. Apply `supabase/migrations/20261028000000_staff_accounts.sql`. Adapt it first if you already have a `profiles` table.
2. Create the owner from your own machine (never put the service-role key in the app):
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OWNER_EMAIL=... OWNER_NAME=... OWNER_PASSWORD=... node scripts/seed-owner.mjs`
3. Deploy `supabase/functions/staff` (`supabase functions deploy staff`). If your API is a separate service, port its four handlers there. `EXPO_PUBLIC_API_URL` must serve `/owner/staff` and `/me/password-changed`.
4. In Supabase Auth settings, keep email confirmation on for customers. Staff accounts are created already confirmed.
5. Write your own RLS policies for orders, menu and the rest using `public.auth_role()`, `public.is_kitchen_staff()` and `public.is_owner()`. They return nothing for disabled accounts.

## How the rules are enforced

- A role can only come from `raw_app_meta_data`, which clients cannot write. A sign-up call with any `data.role` is ignored, so an attacker who calls the Supabase sign-up API directly still gets a customer.
- `profiles.role`, `active` and `must_change_password` are not updatable by clients (column-level grant on name/phone only).
- A unique index guarantees one owner.
- The app hides screens a role should not see, but that is UX. Real enforcement is the Edge Function and your RLS/API checks.

## Known limits

- Disabling bans the user so tokens cannot be refreshed, but an already-issued access token stays valid until it expires (default one hour). Your API should check `profiles.active` on each request.
- A rider's temporary password is shared by the owner out of band (share sheet, in person). There is no email delivery in this reference.
- Password reset by email works only if the staff email is real. For anyone else, the owner resets the password from the Team screen.
- This reference was typechecked and the app was built, but the SQL and Edge Function were **not run against a live Supabase project**. Test them on a staging project first.
