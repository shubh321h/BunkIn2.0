-- Fixes for the Supabase Advisor warnings. Same access rules as before, just cheaper and tighter.
--  1. "Multiple Permissive Policies": one SELECT policy per role and table instead of several.
--  2. "Public / Signed-in users can execute SECURITY DEFINER function": the three role helpers move to a
--     private schema that the API does not expose, and the sign-up trigger function is not callable by anyone.

-- ---------------------------------------------------------------------------------------------
-- 2. Helpers move to a private schema that the public API does not expose.
--    They keep working exactly as before (so the security rules behave the same), but the Advisor no longer
--    sees them as callable over the internet. Signed-out visitors cannot use them at all.
-- ---------------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
alter function public.auth_role() set schema private;
alter function public.is_kitchen_staff() set schema private;
alter function public.is_owner() set schema private;
-- The two wrappers call auth_role() by name, so point them at its new home.
create or replace function private.is_kitchen_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(private.auth_role() in ('owner', 'manager'), false)
$$;
create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(private.auth_role() = 'owner', false)
$$;
revoke execute on function private.auth_role(), private.is_kitchen_staff(), private.is_owner() from public, anon;
grant execute on function private.auth_role(), private.is_kitchen_staff(), private.is_owner() to authenticated, service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated;   -- only the sign-up trigger uses it

-- ---------------------------------------------------------------------------------------------
-- 1. One policy per role and table
-- ---------------------------------------------------------------------------------------------
drop policy "customer reads own orders" on public.orders;
drop policy "kitchen reads all orders" on public.orders;
drop policy "rider reads active assignments" on public.orders;
create policy "orders: who can read" on public.orders for select to authenticated using (
  customer_id = (select auth.uid())
  or (select private.is_kitchen_staff())
  or (rider_id = (select auth.uid()) and (select private.auth_role()) = 'rider' and status not in ('delivered','cancelled')));

drop policy "customer reads own review" on public.reviews;
drop policy "owner reads reviews" on public.reviews;
create policy "reviews: who can read" on public.reviews for select to authenticated using (
  customer_id = (select auth.uid()) or (select private.is_owner()));

drop policy "customer reads own tickets" on public.support_tickets;
drop policy "owner reads tickets" on public.support_tickets;
create policy "tickets: who can read" on public.support_tickets for select to authenticated using (
  customer_id = (select auth.uid()) or (select private.is_owner()));

-- Menu data: signed-out visitors get the storefront rules; signed-in users get the same plus staff extras.
drop policy "storefront categories" on public.categories;
drop policy "kitchen sees all categories" on public.categories;
create policy "categories: signed out" on public.categories for select to anon using (active);
create policy "categories: signed in" on public.categories for select to authenticated using (active or (select private.is_kitchen_staff()));

drop policy "storefront foods" on public.foods;
drop policy "kitchen sees all foods" on public.foods;
create policy "foods: signed out" on public.foods for select to anon using (deleted_at is null);
create policy "foods: signed in" on public.foods for select to authenticated using (deleted_at is null or (select private.is_kitchen_staff()));

drop policy "storefront options" on public.food_options;
drop policy "kitchen sees all options" on public.food_options;
create policy "options: signed out" on public.food_options for select to anon using (
  active and exists (select 1 from public.foods f where f.id = food_id and f.deleted_at is null));
create policy "options: signed in" on public.food_options for select to authenticated using (
  (active and exists (select 1 from public.foods f where f.id = food_id and f.deleted_at is null)) or (select private.is_kitchen_staff()));

drop policy "storefront coupons" on public.coupons;
drop policy "owner sees all coupons" on public.coupons;
create policy "coupons: signed out" on public.coupons for select to anon using (
  active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy "coupons: signed in" on public.coupons for select to authenticated using (
  (active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())) or (select private.is_owner()));
