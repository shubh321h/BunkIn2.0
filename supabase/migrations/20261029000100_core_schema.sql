-- BunkIn core schema: one restaurant, menu, orders, payments, delivery, reviews, support.
-- Depends on 20261028000000_staff_accounts.sql (profiles, app_role).
-- All money is INR numeric(10,2). Variant and add-on prices are ADDED to the dish base price.

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.order_status as enum ('placed','accepted','preparing','ready','picked_up','out_for_delivery','delivered','cancelled');
create type public.delivery_status as enum ('assigned','arriving_at_pickup','picked_up','out_for_delivery','delivered');
create type public.payment_method as enum ('cod','online');
create type public.payment_status as enum ('pending','paid','refund_pending','refunded');
create type public.coupon_kind as enum ('fixed','percentage');
create type public.option_kind as enum ('variant','addon');
create type public.refund_status as enum ('requested','completed','failed');
create type public.ticket_status as enum ('open','answered','closed');
create type public.provider_payment_status as enum ('created','captured','failed');

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Raise a machine-readable error. The API maps message (a CODE) to an HTTP status and shows hint to people.
create function public.fail(code text, hint text default null) returns void language plpgsql as $$
begin raise exception '%', code using hint = coalesce(hint, code), errcode = 'P0001'; end $$;

-- ---------------------------------------------------------------------------------------------
-- The restaurant (exactly one row)
-- ---------------------------------------------------------------------------------------------
create table public.restaurant (
  id boolean primary key default true check (id),
  name text not null default 'BunkIn Kitchen' check (char_length(name) between 2 and 80),
  phone text not null default '' check (phone = '' or phone ~ '^[+]?[0-9 -]{10,15}$'),
  address text not null default '' check (char_length(address) <= 300),
  branding_image text not null default '' check (branding_image = '' or branding_image ~ '^https://'),
  lat numeric(9,6) not null default 0 check (lat between -90 and 90),
  lng numeric(9,6) not null default 0 check (lng between -180 and 180),
  is_open boolean not null default false,
  opens_at time,
  closes_at time,
  holidays date[] not null default '{}',
  timezone text not null default 'Asia/Kolkata',
  delivery_radius_km numeric(6,2) not null default 5 check (delivery_radius_km > 0),
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  tax_rate numeric(5,4) not null default 0.05 check (tax_rate between 0 and 0.5),
  minimum_order numeric(10,2) not null default 0 check (minimum_order >= 0),
  preparation_minutes int not null default 20 check (preparation_minutes between 1 and 240),
  cancellation_window_minutes int not null default 2 check (cancellation_window_minutes between 0 and 30),
  updated_at timestamptz not null default now(),
  constraint restaurant_open_needs_location check (not is_open or lat <> 0 or lng <> 0)
);
create function public.validate_timezone() returns trigger language plpgsql as $$
begin
  perform now() at time zone new.timezone;  -- raises for an unknown zone
  return new;
exception when others then
  raise exception 'INVALID_TIMEZONE' using hint = 'Unknown time zone.', errcode = 'P0001';
end $$;
create trigger restaurant_tz before insert or update on public.restaurant for each row execute function public.validate_timezone();
create trigger restaurant_touch before update on public.restaurant for each row execute function public.set_updated_at();
insert into public.restaurant default values;

-- ---------------------------------------------------------------------------------------------
-- Menu
-- ---------------------------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 40),
  image text not null default '' check (image = '' or image ~ '^https://'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.categories (name, sort_order) values
  ('Burgers',1),('Pizza',2),('Biryani',3),('Pasta',4),('Sides',5),('Desserts',6),('Beverages',7);

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  name text not null check (char_length(name) between 3 and 80),
  description text not null default '' check (char_length(description) <= 500),
  price numeric(10,2) not null check (price > 0),
  original_price numeric(10,2) check (original_price is null or original_price >= price),
  stock int check (stock is null or stock >= 0),              -- null = not inventory-tracked
  image text not null default '' check (image = '' or image ~ '^https://'),
  veg boolean not null default true,
  available boolean not null default true,
  tag text check (tag is null or char_length(tag) <= 30),
  calories int not null default 0 check (calories >= 0),
  prep_time text not null default '' check (char_length(prep_time) <= 30),
  rating numeric(3,2) not null default 0 check (rating between 0 and 5),
  review_count int not null default 0 check (review_count >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index foods_category_idx on public.foods (category_id) where deleted_at is null;
create trigger foods_touch before update on public.foods for each row execute function public.set_updated_at();

-- Variants (exactly one is chosen per line) and add-ons (zero or more). Price is an extra on top of foods.price.
create table public.food_options (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.foods (id) on delete cascade,
  kind public.option_kind not null,
  name text not null check (char_length(name) between 1 and 60),
  price numeric(10,2) not null default 0 check (price >= 0),
  sort_order int not null default 0,
  active boolean not null default true
);
create index food_options_food_idx on public.food_options (food_id);

-- ---------------------------------------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------------------------------------
create table public.coupons (
  code text primary key check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,24}$'),
  title text not null default '',
  description text not null default '',
  kind public.coupon_kind not null,
  value numeric(10,2) not null check (value > 0),
  minimum_order numeric(10,2) not null default 0 check (minimum_order >= 0),
  max_discount numeric(10,2) not null check (max_discount > 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int check (usage_limit is null or usage_limit > 0),
  per_customer_limit int not null default 1 check (per_customer_limit > 0),
  used_count int not null default 0 check (used_count >= 0),
  created_at timestamptz not null default now(),
  constraint coupon_percentage_range check (kind <> 'percentage' or value <= 100),
  constraint coupon_fixed_cap check (kind <> 'fixed' or max_discount >= value),
  constraint coupon_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- ---------------------------------------------------------------------------------------------
-- Customer addresses
-- ---------------------------------------------------------------------------------------------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 30),
  line text not null check (char_length(line) between 5 and 200),
  area text not null default '' check (char_length(area) <= 120),
  contact text not null check (char_length(contact) between 2 and 80),
  phone text not null check (phone ~ '^[+]?[0-9 -]{10,15}$'),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  created_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
create function public.limit_addresses() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.addresses where user_id = new.user_id) >= 10 then
    raise exception 'ADDRESS_LIMIT' using hint = 'You can save up to 10 addresses.', errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger addresses_limit before insert on public.addresses for each row execute function public.limit_addresses();

-- ---------------------------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------------------------
create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.profiles (id),
  status public.order_status not null default 'placed',
  delivery_status public.delivery_status,
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pending',
  subtotal numeric(10,2) not null check (subtotal > 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  tax numeric(10,2) not null default 0 check (tax >= 0),
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  total numeric(10,2) not null,
  coupon_code text references public.coupons (code),
  -- Address is copied at order time so later edits never change an old order.
  address_label text not null,
  address_line text not null,
  address_area text not null default '',
  address_contact text not null,
  address_phone text not null,
  address_lat numeric(9,6) not null,
  address_lng numeric(9,6) not null,
  instructions text not null default '' check (char_length(instructions) <= 300),
  idempotency_key text not null,
  request_hash text not null,
  rider_id uuid references public.profiles (id),
  owner_delivery boolean not null default false,
  preparation_minutes int check (preparation_minutes is null or preparation_minutes between 1 and 240),
  estimated_arrival timestamptz,
  cancel_reason text,
  cancelled_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches check (total = subtotal - discount + tax + delivery_fee),
  constraint orders_discount_cap check (discount <= subtotal),
  constraint orders_idempotency unique (customer_id, idempotency_key),
  constraint orders_one_deliverer check (not (owner_delivery and rider_id is not null))
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_rider_idx on public.orders (rider_id, created_at desc) where rider_id is not null;
create trigger orders_touch before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  food_id uuid references public.foods (id) on delete set null,
  name text not null,
  variant_id uuid,
  variant_name text not null,
  addons jsonb not null default '[]',               -- [{id,name,price}]
  spice text not null default '',
  instructions text not null default '',
  quantity int not null check (quantity between 1 and 20),
  unit_price numeric(10,2) not null check (unit_price > 0),   -- base + variant + add-ons, per unit
  line_total numeric(10,2) not null check (line_total = unit_price * quantity)
);
create index order_items_order_idx on public.order_items (order_id);

-- Delivery OTP. Visible to the customer; checked server-side when the rider completes delivery.
create table public.order_secrets (
  order_id uuid primary key references public.orders (id) on delete cascade,
  delivery_otp text not null check (delivery_otp ~ '^[0-9]{4}$'),
  otp_attempts int not null default 0
);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  actor_role public.app_role,
  event text not null,
  from_status public.order_status,
  to_status public.order_status,
  note text,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events (order_id, created_at);

-- Latest rider position per order. Deleted when the delivery finishes.
create table public.order_rider_location (
  order_id uuid primary key references public.orders (id) on delete cascade,
  rider_id uuid not null references public.profiles (id),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Payments, refunds, cash reconciliation
-- ---------------------------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null,
  provider_order_id text not null,
  provider_payment_id text,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'INR',
  status public.provider_payment_status not null default 'created',
  created_at timestamptz not null default now(),
  unique (provider, provider_order_id)
);
create index payments_order_idx on public.payments (order_id);

-- Webhook de-duplication: the same provider event is processed at most once.
create table public.payment_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null default '{}',
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null default '' check (char_length(reason) <= 300),
  status public.refund_status not null default 'requested',
  requested_by uuid references public.profiles (id),
  provider_refund_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index refunds_one_open_per_order on public.refunds (order_id) where status = 'requested';

create table public.cod_reconciliations (
  order_id uuid primary key references public.orders (id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 0),
  reconciled_by uuid not null references public.profiles (id),
  reconciled_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Reviews, support, notifications, audit
-- ---------------------------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  owner_response text,
  responded_by uuid references public.profiles (id),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create sequence public.ticket_number_seq start 101;
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references public.profiles (id),
  subject text not null check (char_length(subject) between 3 and 120),
  message text not null check (char_length(message) between 5 and 2000),
  status public.ticket_status not null default 'open',
  response text,
  responded_by uuid references public.profiles (id),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index support_customer_idx on public.support_tickets (customer_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  read boolean not null default false,
  order_id uuid references public.orders (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- Owner/manager actions that are not order transitions (menu, settings, coupons, staff). Written by the API.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
