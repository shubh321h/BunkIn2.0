-- Faster security rules (fixes the Supabase advisor warning "Auth RLS Initialization Plan").
-- Same rules as before. The only change: auth.uid() and the role helpers are wrapped in (select ...),
-- so Postgres evaluates them once per query instead of once per row.

-- Also pin a safe search_path on the small helper functions (fixes "Function Search Path Mutable").
alter function public.set_updated_at() set search_path = '';
alter function public.fail(text, text) set search_path = '';
alter function public.validate_timezone() set search_path = '';
alter function public.limit_addresses() set search_path = '';
alter function public.haversine_km(numeric, numeric, numeric, numeric) set search_path = '';

drop policy "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));

drop policy "update own contact details" on public.profiles;
create policy "update own contact details" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy "storefront restaurant" on public.restaurant;
create policy "storefront restaurant" on public.restaurant for select to anon, authenticated using (true);

drop policy "storefront categories" on public.categories;
create policy "storefront categories" on public.categories for select to anon, authenticated using (active);

drop policy "storefront foods" on public.foods;
create policy "storefront foods" on public.foods for select to anon, authenticated using (deleted_at is null);

drop policy "storefront options" on public.food_options;
create policy "storefront options" on public.food_options for select to anon, authenticated using (
  active and exists (select 1 from public.foods f where f.id = food_id and f.deleted_at is null));

drop policy "storefront coupons" on public.coupons;
create policy "storefront coupons" on public.coupons for select to anon, authenticated using (
  active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));

drop policy "kitchen sees all categories" on public.categories;
create policy "kitchen sees all categories" on public.categories for select to authenticated using ((select public.is_kitchen_staff()));

drop policy "kitchen sees all foods" on public.foods;
create policy "kitchen sees all foods" on public.foods for select to authenticated using ((select public.is_kitchen_staff()));

drop policy "kitchen sees all options" on public.food_options;
create policy "kitchen sees all options" on public.food_options for select to authenticated using ((select public.is_kitchen_staff()));

drop policy "owner sees all coupons" on public.coupons;
create policy "owner sees all coupons" on public.coupons for select to authenticated using ((select public.is_owner()));

drop policy "own addresses read" on public.addresses;
create policy "own addresses read" on public.addresses for select to authenticated using (user_id = (select auth.uid()));

drop policy "own addresses add" on public.addresses;
create policy "own addresses add" on public.addresses for insert to authenticated with check (user_id = (select auth.uid()) and (select public.auth_role()) is not null);

drop policy "own addresses edit" on public.addresses;
create policy "own addresses edit" on public.addresses for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy "own addresses delete" on public.addresses;
create policy "own addresses delete" on public.addresses for delete to authenticated using (user_id = (select auth.uid()));

drop policy "customer reads own orders" on public.orders;
create policy "customer reads own orders" on public.orders for select to authenticated using (customer_id = (select auth.uid()));

drop policy "kitchen reads all orders" on public.orders;
create policy "kitchen reads all orders" on public.orders for select to authenticated using ((select public.is_kitchen_staff()));

drop policy "rider reads active assignments" on public.orders;
create policy "rider reads active assignments" on public.orders for select to authenticated using (
  rider_id = (select auth.uid()) and (select public.auth_role()) = 'rider' and status not in ('delivered','cancelled'));

drop policy "order items follow orders" on public.order_items;
create policy "order items follow orders" on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id));

drop policy "order events: customer and kitchen" on public.order_events;
create policy "order events: customer and kitchen" on public.order_events for select to authenticated using (
  (select public.is_kitchen_staff()) or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid())));

drop policy "rider position" on public.order_rider_location;
create policy "rider position" on public.order_rider_location for select to authenticated using (
  (select public.is_kitchen_staff()) or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid())
    and o.status in ('picked_up','out_for_delivery')));

drop policy "customer reads own otp" on public.order_secrets;
create policy "customer reads own otp" on public.order_secrets for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid()) and o.status not in ('delivered','cancelled')));

drop policy "owner reads payments" on public.payments;
create policy "owner reads payments" on public.payments for select to authenticated using ((select public.is_owner()));

drop policy "owner reads refunds" on public.refunds;
create policy "owner reads refunds" on public.refunds for select to authenticated using ((select public.is_owner()));

drop policy "owner reads cash reconciliation" on public.cod_reconciliations;
create policy "owner reads cash reconciliation" on public.cod_reconciliations for select to authenticated using ((select public.is_owner()));

drop policy "owner reads audit log" on public.audit_log;
create policy "owner reads audit log" on public.audit_log for select to authenticated using ((select public.is_owner()));

drop policy "customer reads own review" on public.reviews;
create policy "customer reads own review" on public.reviews for select to authenticated using (customer_id = (select auth.uid()));

drop policy "owner reads reviews" on public.reviews;
create policy "owner reads reviews" on public.reviews for select to authenticated using ((select public.is_owner()));

drop policy "customer reads own tickets" on public.support_tickets;
create policy "customer reads own tickets" on public.support_tickets for select to authenticated using (customer_id = (select auth.uid()));

drop policy "owner reads tickets" on public.support_tickets;
create policy "owner reads tickets" on public.support_tickets for select to authenticated using ((select public.is_owner()));

drop policy "own notifications read" on public.notifications;
create policy "own notifications read" on public.notifications for select to authenticated using (user_id = (select auth.uid()));

drop policy "own notifications mark read" on public.notifications;
create policy "own notifications mark read" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
