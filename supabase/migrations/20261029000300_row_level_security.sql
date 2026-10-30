-- Row Level Security. The API (service role) is the normal door; these rules protect the data if anyone
-- talks to the database directly with the public key. Clients can READ what they may see and change almost nothing:
-- orders, payments, roles and prices change only through the service-role functions.

alter table public.restaurant enable row level security;
alter table public.categories enable row level security;
alter table public.foods enable row level security;
alter table public.food_options enable row level security;
alter table public.coupons enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_secrets enable row level security;
alter table public.order_events enable row level security;
alter table public.order_rider_location enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
alter table public.cod_reconciliations enable row level security;
alter table public.reviews enable row level security;
alter table public.support_tickets enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

-- Start from nothing for the public roles, then grant back precisely.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- The first migration's profile grants were just revoked with everything else: grant them back.
grant select on public.profiles to authenticated;
grant update (name, phone) on public.profiles to authenticated;

-- ---- Public storefront (readable by anyone, including signed-out visitors) ----
grant select on public.restaurant, public.categories, public.foods, public.food_options to anon, authenticated;
grant select (code, title, description, kind, value, minimum_order, max_discount, active, starts_at, ends_at) on public.coupons to anon, authenticated;
create policy "storefront restaurant" on public.restaurant for select to anon, authenticated using (true);
create policy "storefront categories" on public.categories for select to anon, authenticated using (active);
create policy "storefront foods" on public.foods for select to anon, authenticated using (deleted_at is null);
create policy "storefront options" on public.food_options for select to anon, authenticated using (
  active and exists (select 1 from public.foods f where f.id = food_id and f.deleted_at is null));
create policy "storefront coupons" on public.coupons for select to anon, authenticated using (
  active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
-- Kitchen staff also see inactive categories, deleted dishes and hidden options.
create policy "kitchen sees all categories" on public.categories for select to authenticated using (public.is_kitchen_staff());
create policy "kitchen sees all foods" on public.foods for select to authenticated using (public.is_kitchen_staff());
create policy "kitchen sees all options" on public.food_options for select to authenticated using (public.is_kitchen_staff());
create policy "owner sees all coupons" on public.coupons for select to authenticated using (public.is_owner());
grant select on public.coupons to authenticated;  -- all columns, but only rows the policies above allow

-- ---- Customer addresses: full control over their own ----
grant select, insert, update, delete on public.addresses to authenticated;
create policy "own addresses read" on public.addresses for select to authenticated using (user_id = auth.uid());
create policy "own addresses add" on public.addresses for insert to authenticated with check (user_id = auth.uid() and public.auth_role() is not null);
create policy "own addresses edit" on public.addresses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own addresses delete" on public.addresses for delete to authenticated using (user_id = auth.uid());

-- ---- Orders: read only ----
grant select on public.orders, public.order_items, public.order_events, public.order_rider_location to authenticated;
create policy "customer reads own orders" on public.orders for select to authenticated using (customer_id = auth.uid());
create policy "kitchen reads all orders" on public.orders for select to authenticated using (public.is_kitchen_staff());
create policy "rider reads active assignments" on public.orders for select to authenticated using (
  rider_id = auth.uid() and public.auth_role() = 'rider' and status not in ('delivered','cancelled'));
create policy "order items follow orders" on public.order_items for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id));       -- the orders policies above apply here too
create policy "order events: customer and kitchen" on public.order_events for select to authenticated using (
  public.is_kitchen_staff() or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
-- Live rider position: kitchen always; the customer only once the order is on the road.
create policy "rider position" on public.order_rider_location for select to authenticated using (
  public.is_kitchen_staff() or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()
    and o.status in ('picked_up','out_for_delivery')));

-- The delivery OTP: only the customer who owns the order, and only while it is active.
grant select on public.order_secrets to authenticated;
create policy "customer reads own otp" on public.order_secrets for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid() and o.status not in ('delivered','cancelled')));

-- ---- Money: owner only ----
grant select on public.payments, public.refunds, public.cod_reconciliations, public.audit_log to authenticated;
create policy "owner reads payments" on public.payments for select to authenticated using (public.is_owner());
create policy "owner reads refunds" on public.refunds for select to authenticated using (public.is_owner());
create policy "owner reads cash reconciliation" on public.cod_reconciliations for select to authenticated using (public.is_owner());
create policy "owner reads audit log" on public.audit_log for select to authenticated using (public.is_owner());
-- payment_events holds raw provider payloads: no client access at all.

-- ---- Reviews and support ----
grant select on public.reviews, public.support_tickets to authenticated;
create policy "customer reads own review" on public.reviews for select to authenticated using (customer_id = auth.uid());
create policy "owner reads reviews" on public.reviews for select to authenticated using (public.is_owner());
create policy "customer reads own tickets" on public.support_tickets for select to authenticated using (customer_id = auth.uid());
create policy "owner reads tickets" on public.support_tickets for select to authenticated using (public.is_owner());

-- ---- Notifications: read your own, mark them read ----
grant select on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
create policy "own notifications read" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own notifications mark read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Realtime (if enabled): clients still only receive rows the policies above allow ----
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders, public.order_rider_location, public.notifications;
  end if;
end $$;

-- Future tables/functions created by other migrations must be granted deliberately.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
