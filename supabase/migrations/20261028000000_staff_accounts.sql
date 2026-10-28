-- BunkIn: single restaurant, owner-issued staff accounts.
-- Review against your existing schema before applying. This file only adds profiles/roles.

create type public.app_role as enum ('customer', 'owner', 'manager', 'rider');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  phone text not null default '',
  role public.app_role not null default 'customer',
  active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

-- One restaurant, one owner. A second owner row is rejected by the database itself.
create unique index only_one_owner on public.profiles ((true)) where role = 'owner';

-- Roles come ONLY from raw_app_meta_data, which clients cannot write (sign-up data goes to
-- raw_user_meta_data). Public sign-up therefore always produces a customer.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  assigned public.app_role := 'customer';
begin
  if (new.raw_app_meta_data ->> 'role') in ('owner', 'manager', 'rider') then
    assigned := (new.raw_app_meta_data ->> 'role')::public.app_role;
  end if;
  insert into public.profiles (id, email, name, role, must_change_password)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', ''), assigned, assigned <> 'customer');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Clients may read their own profile and edit only name/phone. Role, active and
-- must_change_password are writable only by the service role (Edge Function / seed script).
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, phone) on public.profiles to authenticated;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "update own contact details" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Helpers for the policies on your orders/menu/etc. tables. Disabled accounts get no role.
create function public.auth_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create function public.is_kitchen_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() in ('owner', 'manager'), false)
$$;
create function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'owner', false)
$$;
