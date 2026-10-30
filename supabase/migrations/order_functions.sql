-- BunkIn business rules, enforced in the database so the API cannot get them wrong.
-- Every function here is callable ONLY by the service role (your API / Edge Function), which must first
-- authenticate the caller's JWT and pass that user's id. Errors are raised as: message = CODE, hint = text for people.
--
-- Error codes (map to HTTP in the API):
--   400 BAD_IDEMPOTENCY_KEY EMPTY_CART INVALID_ITEM INVALID_OPTION INVALID_ADDRESS INVALID_COUPON REASON_REQUIRED INVALID_RATING
--   403 FORBIDDEN ACCOUNT_DISABLED        404 NOT_FOUND
--   409 IDEMPOTENCY_CONFLICT ITEM_UNAVAILABLE OUT_OF_STOCK RESTAURANT_CLOSED RESTAURANT_HOLIDAY OUT_OF_RANGE BELOW_MINIMUM
--       COUPON_MINIMUM COUPON_EXHAUSTED COUPON_USED INVALID_TRANSITION PAYMENT_PENDING CANCEL_NOT_ALLOWED
--       CANCEL_WINDOW_EXPIRED ALREADY_REVIEWED NOT_DELIVERED NOT_REFUNDABLE ALREADY_RECONCILED NOT_ONLINE
--   429 RATE_LIMITED SUPPORT_LIMIT        422 STALE_LOCATION

-- ---------------------------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------------------------
create function public.haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric language sql immutable as $$
  select (6371 * 2 * asin(least(1, sqrt(
    power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
    cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2)
  ))))::numeric
$$;

-- Role of an ACTIVE account, or null. Never trust a role passed in by a caller.
create function public.actor_role(p_actor uuid) returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = p_actor and active
$$;

create function public.notify(p_user uuid, p_title text, p_body text, p_order uuid default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, title, body, order_id) values (p_user, p_title, coalesce(p_body, ''), p_order)
$$;

create function public.notify_staff(p_title text, p_body text, p_order uuid default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, title, body, order_id)
  select id, p_title, coalesce(p_body, ''), p_order from public.profiles where role in ('owner','manager') and active
$$;

create function public.refresh_food_ratings(p_order uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.foods f set rating = s.avg_rating, review_count = s.cnt
  from (
    select food_id, round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as cnt
    from (
      select distinct i.food_id, r.id as review_id, r.rating
      from public.order_items i join public.reviews r on r.order_id = i.order_id
      where i.food_id in (select food_id from public.order_items where order_id = p_order and food_id is not null)
    ) x group by food_id
  ) s
  where f.id = s.food_id
$$;

-- ---------------------------------------------------------------------------------------------
-- order_json: the Order shape the app expects. Visibility is decided here, per viewer:
--   customer: own orders; rider details only while active; live position only once picked up; delivery OTP while active
--   owner/manager: everything
--   rider: only own assignments; customer contact only while the delivery is active
-- ---------------------------------------------------------------------------------------------
create function public.order_json(p_order uuid, p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype;
  v_role public.app_role := public.actor_role(p_viewer);
  v_kitchen boolean; v_customer boolean; v_rider boolean; v_active boolean; v_contact boolean;
  v_items jsonb; v_address jsonb; v_rider_json jsonb; v_otp text;
  v_name text; v_phone text; v_loc record;
begin
  if v_role is null then return null; end if;
  select * into o from public.orders where id = p_order;
  if not found then return null; end if;
  v_kitchen := v_role in ('owner','manager');
  v_customer := o.customer_id = p_viewer;
  v_rider := o.rider_id = p_viewer;
  if not (v_kitchen or v_customer or v_rider) then return null; end if;
  v_active := o.status not in ('delivered','cancelled');
  v_contact := v_kitchen or v_customer or (v_rider and v_active);

  select coalesce(jsonb_agg(jsonb_build_object(
      'foodId', i.food_id, 'name', i.name, 'quantity', i.quantity, 'price', i.unit_price,
      'variant', i.variant_name,
      'addons', (select coalesce(jsonb_agg(a ->> 'name'), '[]'::jsonb) from jsonb_array_elements(i.addons) a),
      'spice', i.spice, 'instructions', i.instructions) order by i.name), '[]'::jsonb)
    into v_items from public.order_items i where i.order_id = o.id;

  v_address := case when v_contact then jsonb_build_object(
      'id', o.id, 'label', o.address_label, 'line', o.address_line, 'area', o.address_area,
      'contact', o.address_contact, 'phone', o.address_phone,
      'location', jsonb_build_object('lat', o.address_lat, 'lng', o.address_lng))
    else jsonb_build_object('id', o.id, 'label', o.address_label, 'line', '', 'area', o.address_area,
      'contact', '', 'phone', '', 'location', jsonb_build_object('lat', 0, 'lng', 0)) end;

  if o.rider_id is not null then
    select name, phone into v_name, v_phone from public.profiles where id = o.rider_id;
    v_rider_json := jsonb_build_object('id', o.rider_id, 'name', v_name);
    if v_kitchen or (v_customer and v_active) then
      v_rider_json := v_rider_json || jsonb_build_object('phone', v_phone);
    end if;
    if v_kitchen or (v_customer and o.status in ('picked_up','out_for_delivery')) then
      select lat, lng, recorded_at into v_loc from public.order_rider_location where order_id = o.id;
      if found then
        v_rider_json := v_rider_json || jsonb_build_object(
          'location', jsonb_build_object('lat', v_loc.lat, 'lng', v_loc.lng), 'updatedAt', v_loc.recorded_at);
      end if;
    end if;
  end if;

  if v_customer and v_active then
    select delivery_otp into v_otp from public.order_secrets where order_id = o.id;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', o.id, 'number', o.number, 'createdAt', o.created_at, 'status', o.status, 'deliveryStatus', o.delivery_status,
    'items', v_items, 'total', o.total, 'payment', o.payment_method, 'paymentStatus', o.payment_status,
    'address', v_address, 'instructions', o.instructions, 'rider', v_rider_json,
    'ownerDelivery', case when o.owner_delivery then true end,
    'estimatedArrival', o.estimated_arrival, 'preparationMinutes', o.preparation_minutes,
    'subtotal', case when v_rider then null else o.subtotal end,
    'discount', case when v_rider then null else o.discount end,
    'tax', case when v_rider then null else o.tax end,
    'deliveryFee', case when v_rider then null else o.delivery_fee end,
    'couponCode', case when v_rider then null else o.coupon_code end,
    'cancelReason', o.cancel_reason,
    'deliveryOtp', v_otp));
end $$;

-- Orders for a viewer. scope: 'mine' (own orders) | 'kitchen' (owner/manager, all) | 'active' / 'history' (rider)
create function public.list_orders(p_viewer uuid, p_scope text) returns setof jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role public.app_role := public.actor_role(p_viewer); r record;
begin
  if v_role is null then perform public.fail('ACCOUNT_DISABLED', 'This account is disabled.'); end if;
  if p_scope = 'mine' then
    for r in select id from public.orders where customer_id = p_viewer order by created_at desc limit 100 loop
      return next public.order_json(r.id, p_viewer);
    end loop;
  elsif p_scope = 'kitchen' then
    if v_role not in ('owner','manager') then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
    for r in select id from public.orders order by created_at desc limit 300 loop
      return next public.order_json(r.id, p_viewer);
    end loop;
  elsif p_scope in ('active','history') then
    if v_role <> 'rider' then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
    for r in select id from public.orders where rider_id = p_viewer
        and ((p_scope = 'active' and status not in ('delivered','cancelled')) or (p_scope = 'history' and status = 'delivered'))
        order by created_at desc limit 100 loop
      return next public.order_json(r.id, p_viewer);
    end loop;
  else
    perform public.fail('NOT_FOUND', 'Unknown list.');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- place_order: validates everything and recomputes every amount. Client totals are never used.
-- p_items:   [{foodId, quantity, variantId, addonIds[], spice, instructions}]
-- p_address: {label, line, area, contact, phone, location:{lat,lng}}
-- A repeated idempotency key with the same payload returns the same order; with a different payload it is rejected.
-- ---------------------------------------------------------------------------------------------
create function public.place_order(
  p_customer uuid, p_items jsonb, p_address jsonb, p_coupon text,
  p_payment public.payment_method, p_instructions text, p_key text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.restaurant%rowtype;
  v_hash text; v_existing record; v_local timestamp; v_time time; v_open boolean;
  v_lat numeric; v_lng numeric; v_line text; v_area text; v_contact text; v_phone text; v_label text;
  v_item jsonb; v_food public.foods%rowtype; v_variant public.food_options%rowtype;
  v_qty int; v_addon_ids uuid[]; v_addon_count int; v_addon_total numeric; v_addons jsonb;
  v_unit numeric; v_subtotal numeric := 0; v_lines jsonb := '[]'::jsonb;
  v_coupon public.coupons%rowtype; v_has_coupon boolean := false; v_discount numeric := 0; v_used int;
  v_tax numeric; v_total numeric; v_order uuid; v_number text; v_otp text; v_instr text;
begin
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 100 then
    perform public.fail('BAD_IDEMPOTENCY_KEY', 'Please try placing the order again.');
  end if;
  if public.actor_role(p_customer) is null then perform public.fail('ACCOUNT_DISABLED', 'This account is disabled.'); end if;

  -- Serialise retries of the same request so stock is never taken twice.
  perform pg_advisory_xact_lock(hashtextextended(p_customer::text || ':' || p_key, 0));

  v_instr := left(coalesce(p_instructions, ''), 300);
  v_hash := md5(coalesce(p_items::text, '') || '|' || coalesce(p_address::text, '') || '|' ||
                coalesce(upper(trim(p_coupon)), '') || '|' || p_payment::text || '|' || v_instr);
  select id, request_hash into v_existing from public.orders where customer_id = p_customer and idempotency_key = p_key;
  if found then
    if v_existing.request_hash = v_hash then return v_existing.id; end if;
    perform public.fail('IDEMPOTENCY_CONFLICT', 'This order changed. Please review your cart and try again.');
  end if;

  select * into r from public.restaurant for share;
  v_local := now() at time zone r.timezone;
  v_time := v_local::time;
  if not r.is_open then perform public.fail('RESTAURANT_CLOSED', 'The kitchen is not taking orders right now.'); end if;
  if v_local::date = any (r.holidays) then perform public.fail('RESTAURANT_HOLIDAY', 'The kitchen is closed today.'); end if;
  if r.opens_at is not null and r.closes_at is not null then
    v_open := case when r.opens_at <= r.closes_at then v_time >= r.opens_at and v_time < r.closes_at
                   else v_time >= r.opens_at or v_time < r.closes_at end;
    if not v_open then perform public.fail('RESTAURANT_CLOSED', 'The kitchen is closed at this hour.'); end if;
  end if;

  -- Delivery address and radius
  begin
    v_lat := (p_address #>> '{location,lat}')::numeric;
    v_lng := (p_address #>> '{location,lng}')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    perform public.fail('INVALID_ADDRESS', 'Please choose a valid delivery location.');
  end;
  v_label := left(coalesce(nullif(trim(p_address ->> 'label'), ''), 'Home'), 30);
  v_line := trim(coalesce(p_address ->> 'line', ''));
  v_area := left(trim(coalesce(p_address ->> 'area', '')), 120);
  v_contact := trim(coalesce(p_address ->> 'contact', ''));
  v_phone := trim(coalesce(p_address ->> 'phone', ''));
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180
     or char_length(v_line) not between 5 and 200 or char_length(v_contact) not between 2 and 80
     or v_phone !~ '^[+]?[0-9 -]{10,15}$' then
    perform public.fail('INVALID_ADDRESS', 'Please check the delivery address, name and phone number.');
  end if;
  if (r.lat <> 0 or r.lng <> 0) and public.haversine_km(r.lat, r.lng, v_lat, v_lng) > r.delivery_radius_km then
    perform public.fail('OUT_OF_RANGE', 'This address is outside our delivery area.');
  end if;

  -- Items: prices always come from the database.
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    perform public.fail('EMPTY_CART', 'Your cart is empty or too large.');
  end if;
  begin
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := (v_item ->> 'quantity')::int;
      if v_qty is null or v_qty not between 1 and 20 then perform public.fail('INVALID_ITEM', 'Choose between 1 and 20 of each dish.'); end if;

      select f.* into v_food from public.foods f join public.categories c on c.id = f.category_id
        where f.id = (v_item ->> 'foodId')::uuid and f.deleted_at is null and c.active for update of f;
      if not found or not v_food.available then
        perform public.fail('ITEM_UNAVAILABLE', 'A dish in your cart is no longer available.');
      end if;
      if v_food.stock is not null then
        if v_food.stock < v_qty then perform public.fail('OUT_OF_STOCK', v_food.name || ' is sold out.'); end if;
        update public.foods set stock = stock - v_qty where id = v_food.id;
      end if;

      select * into v_variant from public.food_options
        where id = (v_item ->> 'variantId')::uuid and food_id = v_food.id and kind = 'variant' and active;
      if not found then perform public.fail('INVALID_OPTION', 'Choose a valid size or variant for ' || v_food.name || '.'); end if;

      v_addon_ids := coalesce(array(select distinct x::uuid from jsonb_array_elements_text(coalesce(v_item -> 'addonIds', '[]'::jsonb)) x), '{}');
      if cardinality(v_addon_ids) > 10 then perform public.fail('INVALID_OPTION', 'Too many add-ons.'); end if;
      select count(*), coalesce(sum(price), 0),
             coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) order by sort_order, name), '[]'::jsonb)
        into v_addon_count, v_addon_total, v_addons
        from public.food_options where id = any (v_addon_ids) and food_id = v_food.id and kind = 'addon' and active;
      if v_addon_count <> cardinality(v_addon_ids) then perform public.fail('INVALID_OPTION', 'An add-on is no longer available.'); end if;

      v_unit := v_food.price + v_variant.price + v_addon_total;
      v_subtotal := v_subtotal + v_unit * v_qty;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'food_id', v_food.id, 'name', v_food.name, 'variant_id', v_variant.id, 'variant_name', v_variant.name,
        'addons', v_addons, 'spice', left(coalesce(v_item ->> 'spice', ''), 30),
        'instructions', left(coalesce(v_item ->> 'instructions', ''), 200), 'quantity', v_qty, 'unit_price', v_unit));
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    perform public.fail('INVALID_ITEM', 'Something in your cart is invalid. Please refresh the menu.');
  end;

  if v_subtotal < r.minimum_order then
    perform public.fail('BELOW_MINIMUM', 'The minimum order is ' || r.minimum_order || '.');
  end if;

  -- Coupon (percentage and fixed are both capped at max_discount AND at the subtotal)
  if p_coupon is not null and trim(p_coupon) <> '' then
    select * into v_coupon from public.coupons
      where code = upper(trim(p_coupon)) and active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
      for update;
    if not found then perform public.fail('INVALID_COUPON', 'This coupon is not valid.'); end if;
    if v_subtotal < v_coupon.minimum_order then
      perform public.fail('COUPON_MINIMUM', 'Add more items to use this coupon.');
    end if;
    if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
      perform public.fail('COUPON_EXHAUSTED', 'This coupon has been fully used.');
    end if;
    select count(*) into v_used from public.orders
      where customer_id = p_customer and coupon_code = v_coupon.code and status <> 'cancelled';
    if v_used >= v_coupon.per_customer_limit then perform public.fail('COUPON_USED', 'You have already used this coupon.'); end if;
    v_discount := case v_coupon.kind when 'fixed' then v_coupon.value else round(v_subtotal * v_coupon.value / 100, 2) end;
    v_discount := least(v_discount, v_coupon.max_discount, v_subtotal);
    v_has_coupon := true;
  end if;

  v_tax := round((v_subtotal - v_discount) * r.tax_rate, 2);
  v_total := v_subtotal - v_discount + v_tax + r.delivery_fee;

  v_number := 'BK-' || lpad(nextval('public.order_number_seq')::text, 6, '0');
  insert into public.orders (number, customer_id, payment_method, subtotal, discount, tax, delivery_fee, total, coupon_code,
      address_label, address_line, address_area, address_contact, address_phone, address_lat, address_lng,
      instructions, idempotency_key, request_hash)
    values (v_number, p_customer, p_payment, v_subtotal, v_discount, v_tax, r.delivery_fee, v_total,
      case when v_has_coupon then v_coupon.code end,
      v_label, v_line, v_area, v_contact, v_phone, v_lat, v_lng, v_instr, p_key, v_hash)
    returning id into v_order;

  insert into public.order_items (order_id, food_id, name, variant_id, variant_name, addons, spice, instructions, quantity, unit_price, line_total)
    select v_order, (l ->> 'food_id')::uuid, l ->> 'name', (l ->> 'variant_id')::uuid, l ->> 'variant_name', l -> 'addons',
           l ->> 'spice', l ->> 'instructions', (l ->> 'quantity')::int, (l ->> 'unit_price')::numeric,
           (l ->> 'unit_price')::numeric * (l ->> 'quantity')::int
    from jsonb_array_elements(v_lines) l;

  -- Random 4-digit delivery OTP (cryptographically random uuid bytes)
  v_otp := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 10000)::text, 4, '0');
  insert into public.order_secrets (order_id, delivery_otp) values (v_order, v_otp);

  if v_has_coupon then update public.coupons set used_count = used_count + 1 where code = v_coupon.code; end if;
  insert into public.order_events (order_id, actor_id, actor_role, event, to_status) values (v_order, p_customer, public.actor_role(p_customer), 'placed', 'placed');
  perform public.notify(p_customer, 'Order placed', 'We have received order ' || v_number || '.', v_order);
  perform public.notify_staff('New order ' || v_number, 'A new order is waiting.', v_order);
  return v_order;
end $$;

-- Online orders: record the provider order that will collect payment. Returns the amount to charge.
create function public.create_payment_record(p_order uuid, p_customer uuid, p_provider text, p_provider_order_id text)
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order and customer_id = p_customer for update;
  if not found then perform public.fail('NOT_FOUND', 'Order not found.'); end if;
  if o.payment_method <> 'online' then perform public.fail('NOT_ONLINE', 'This order is not an online payment.'); end if;
  if o.payment_status <> 'pending' or o.status <> 'placed' then perform public.fail('INVALID_TRANSITION', 'This order cannot be paid now.'); end if;
  insert into public.payments (order_id, provider, provider_order_id, amount) values (o.id, p_provider, p_provider_order_id, o.total)
    on conflict (provider, provider_order_id) do nothing;
  return o.total;
end $$;

-- Payment webhook (call AFTER verifying the provider signature). Idempotent per provider event.
-- Returns 'ok' | 'duplicate' | 'unknown_order' | 'amount_mismatch'. Never trust a client redirect as proof of payment.
create function public.record_payment_captured(
  p_provider text, p_event_id text, p_provider_order_id text, p_provider_payment_id text, p_amount numeric, p_payload jsonb
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows int; p public.payments%rowtype; o public.orders%rowtype;
begin
  insert into public.payment_events (provider, event_id, payload) values (p_provider, p_event_id, coalesce(p_payload, '{}'))
    on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return 'duplicate'; end if;
  select * into p from public.payments where provider = p_provider and provider_order_id = p_provider_order_id for update;
  if not found then return 'unknown_order'; end if;
  select * into o from public.orders where id = p.order_id for update;
  if p_amount <> o.total or p.amount <> o.total then
    update public.payments set status = 'failed' where id = p.id;
    insert into public.order_events (order_id, event, note) values (o.id, 'payment_amount_mismatch', 'expected ' || o.total || ' got ' || p_amount);
    return 'amount_mismatch';
  end if;
  update public.payments set status = 'captured', provider_payment_id = p_provider_payment_id where id = p.id;
  if o.payment_status = 'pending' and o.status <> 'cancelled' then
    update public.orders set payment_status = 'paid' where id = o.id;
    insert into public.order_events (order_id, event, note) values (o.id, 'payment_captured', p_provider_payment_id);
    perform public.notify(o.customer_id, 'Payment received', 'Thank you. Order ' || o.number || ' is paid.', o.id);
    perform public.notify_staff('Order ' || o.number || ' is paid', 'You can accept it now.', o.id);
  elsif o.status = 'cancelled' and o.payment_status = 'pending' then
    -- Money arrived for an order that was cancelled meanwhile: queue the refund.
    update public.orders set payment_status = 'refund_pending' where id = o.id;
    insert into public.refunds (order_id, amount, reason) values (o.id, o.total, 'Paid after cancellation')
      on conflict do nothing;
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Status changes by customer (cancel) and owner/manager
-- ---------------------------------------------------------------------------------------------
create function public.change_order_status(p_order uuid, p_to public.order_status, p_actor uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders%rowtype; v_role public.app_role := public.actor_role(p_actor); v_window interval; v_msg text;
begin
  if v_role is null then perform public.fail('ACCOUNT_DISABLED', 'This account is disabled.'); end if;
  select * into o from public.orders where id = p_order for update;
  if not found then perform public.fail('NOT_FOUND', 'Order not found.'); end if;
  if o.status = p_to then return; end if;

  if v_role in ('owner','manager') then
    if p_to = 'cancelled' then
      if o.status not in ('placed','accepted','preparing','ready') then
        perform public.fail('INVALID_TRANSITION', 'This order can no longer be cancelled.');
      end if;
      if char_length(trim(coalesce(p_reason, ''))) < 3 then perform public.fail('REASON_REQUIRED', 'Please give a reason.'); end if;
    elsif not ((o.status = 'placed' and p_to = 'accepted') or (o.status = 'accepted' and p_to = 'preparing')
            or (o.status = 'preparing' and p_to = 'ready')
            or (o.owner_delivery and ((o.status = 'ready' and p_to = 'picked_up')
                                   or (o.status = 'picked_up' and p_to = 'out_for_delivery')
                                   or (o.status = 'out_for_delivery' and p_to = 'delivered')))) then
      perform public.fail('INVALID_TRANSITION', 'That step is not allowed from ' || o.status || '.');
    end if;
    if p_to = 'accepted' and o.payment_method = 'online' and o.payment_status <> 'paid' then
      perform public.fail('PAYMENT_PENDING', 'Wait for the online payment before accepting.');
    end if;
  elsif v_role = 'customer' and o.customer_id = p_actor then
    if p_to <> 'cancelled' then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
    if o.status <> 'placed' then perform public.fail('CANCEL_NOT_ALLOWED', 'The kitchen has already started this order.'); end if;
    select make_interval(mins => cancellation_window_minutes) into v_window from public.restaurant;
    if now() > o.created_at + v_window then perform public.fail('CANCEL_WINDOW_EXPIRED', 'The cancellation window has passed.'); end if;
  else
    perform public.fail('NOT_FOUND', 'Order not found.');
  end if;

  update public.orders set
    status = p_to,
    delivery_status = case p_to when 'picked_up' then 'picked_up'::public.delivery_status
                                when 'out_for_delivery' then 'out_for_delivery'::public.delivery_status
                                when 'delivered' then 'delivered'::public.delivery_status
                                when 'cancelled' then null else delivery_status end,
    cancel_reason = case when p_to = 'cancelled' then left(coalesce(p_reason, 'Cancelled by customer'), 300) else cancel_reason end,
    cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end,
    delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
    payment_status = case when p_to = 'delivered' and payment_method = 'cod' then 'paid'::public.payment_status
                          when p_to = 'cancelled' and payment_status = 'paid' then 'refund_pending'::public.payment_status
                          else payment_status end
  where id = o.id;

  if p_to = 'cancelled' then
    -- Put stock and the coupon use back, queue a refund if money was taken.
    update public.foods f set stock = f.stock + s.q
      from (select food_id, sum(quantity)::int as q from public.order_items where order_id = o.id and food_id is not null group by food_id) s
      where f.id = s.food_id and f.stock is not null;
    if o.coupon_code is not null then update public.coupons set used_count = greatest(used_count - 1, 0) where code = o.coupon_code; end if;
    if o.payment_status = 'paid' then
      insert into public.refunds (order_id, amount, reason, requested_by) values (o.id, o.total, 'Order cancelled', p_actor)
        on conflict do nothing;
    end if;
    if o.rider_id is not null then perform public.notify(o.rider_id, 'Delivery cancelled', 'Order ' || o.number || ' was cancelled.', o.id); end if;
  end if;
  if p_to = 'delivered' then delete from public.order_rider_location where order_id = o.id; end if;

  insert into public.order_events (order_id, actor_id, actor_role, event, from_status, to_status, note)
    values (o.id, p_actor, v_role, 'status', o.status, p_to, p_reason);
  v_msg := case p_to when 'accepted' then 'Your order was accepted.' when 'preparing' then 'We are preparing your order.'
    when 'ready' then 'Your order is ready.' when 'picked_up' then 'Your order has been picked up.'
    when 'out_for_delivery' then 'Your order is on its way.' when 'delivered' then 'Delivered. Enjoy your meal!'
    when 'cancelled' then 'Your order was cancelled.' else null end;
  if v_msg is not null and o.customer_id <> p_actor then perform public.notify(o.customer_id, 'Order ' || o.number, v_msg, o.id); end if;
end $$;

create function public.owner_set_preparation(p_order uuid, p_actor uuid, p_minutes int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.actor_role(p_actor) not in ('owner','manager') then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
  if p_minutes is null or p_minutes not between 1 and 240 then perform public.fail('INVALID_ITEM', 'Preparation time must be 1 to 240 minutes.'); end if;
  update public.orders set preparation_minutes = p_minutes where id = p_order and status in ('placed','accepted','preparing');
  if not found then perform public.fail('INVALID_TRANSITION', 'The preparation time can no longer be changed.'); end if;
end $$;

-- Assign a rider. p_rider = null means the restaurant delivers the order itself ("riderId: owner").
create function public.assign_rider(p_order uuid, p_actor uuid, p_rider uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders%rowtype;
begin
  if public.actor_role(p_actor) not in ('owner','manager') then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
  select * into o from public.orders where id = p_order for update;
  if not found then perform public.fail('NOT_FOUND', 'Order not found.'); end if;
  if o.status not in ('accepted','preparing','ready') then
    perform public.fail('INVALID_TRANSITION', 'A rider can only be assigned before pickup.');
  end if;
  if p_rider is not null and public.actor_role(p_rider) is distinct from 'rider' then
    perform public.fail('NOT_FOUND', 'That rider is not available.');
  end if;
  update public.orders set rider_id = p_rider, owner_delivery = (p_rider is null),
    delivery_status = case when p_rider is null then null else 'assigned'::public.delivery_status end where id = o.id;
  insert into public.order_events (order_id, actor_id, actor_role, event, note)
    values (o.id, p_actor, public.actor_role(p_actor), 'rider_assigned', coalesce(p_rider::text, 'owner'));
  if p_rider is not null then perform public.notify(p_rider, 'New delivery', 'Order ' || o.number || ' is assigned to you.', o.id); end if;
  if o.rider_id is not null and o.rider_id is distinct from p_rider then
    perform public.notify(o.rider_id, 'Delivery reassigned', 'Order ' || o.number || ' was reassigned.', o.id);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Rider actions
-- p_status: arriving_at_pickup | picked_up | out_for_delivery | delivered (requires the customer's OTP)
-- Returns 'ok' | 'OTP_INVALID' | 'OTP_LOCKED'. (Returned, not raised, so failed attempts are still counted.)
-- ---------------------------------------------------------------------------------------------
create function public.rider_update(p_order uuid, p_rider uuid, p_status text, p_otp text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders%rowtype; v_secret public.order_secrets%rowtype;
begin
  if public.actor_role(p_rider) is distinct from 'rider' then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
  select * into o from public.orders where id = p_order and rider_id = p_rider for update;
  if not found then perform public.fail('NOT_FOUND', 'Assignment not found.'); end if;

  if p_status = 'arriving_at_pickup' then
    if o.status not in ('accepted','preparing','ready') or o.delivery_status is distinct from 'assigned' then
      perform public.fail('INVALID_TRANSITION', 'Not a valid step now.');
    end if;
    update public.orders set delivery_status = 'arriving_at_pickup' where id = o.id;
  elsif p_status = 'picked_up' then
    if o.status <> 'ready' or o.delivery_status not in ('assigned','arriving_at_pickup') then
      perform public.fail('INVALID_TRANSITION', 'The kitchen has not marked this order ready.');
    end if;
    update public.orders set status = 'picked_up', delivery_status = 'picked_up' where id = o.id;
    perform public.notify(o.customer_id, 'Order ' || o.number, 'Your order has been picked up.', o.id);
  elsif p_status = 'out_for_delivery' then
    if o.status <> 'picked_up' then perform public.fail('INVALID_TRANSITION', 'Pick the order up first.'); end if;
    update public.orders set status = 'out_for_delivery', delivery_status = 'out_for_delivery' where id = o.id;
    perform public.notify(o.customer_id, 'Order ' || o.number, 'Your order is on its way. Keep your delivery code ready.', o.id);
  elsif p_status = 'delivered' then
    if o.status <> 'out_for_delivery' then perform public.fail('INVALID_TRANSITION', 'The order is not out for delivery.'); end if;
    select * into v_secret from public.order_secrets where order_id = o.id for update;
    if v_secret.otp_attempts >= 5 then return 'OTP_LOCKED'; end if;
    if p_otp is null or p_otp is distinct from v_secret.delivery_otp then
      update public.order_secrets set otp_attempts = otp_attempts + 1 where order_id = o.id;
      if v_secret.otp_attempts + 1 >= 5 then
        perform public.notify_staff('Delivery code locked', 'Order ' || o.number || ': too many wrong codes. Check with the customer.', o.id);
        return 'OTP_LOCKED';
      end if;
      return 'OTP_INVALID';
    end if;
    update public.orders set status = 'delivered', delivery_status = 'delivered', delivered_at = now(),
      payment_status = case when payment_method = 'cod' then 'paid'::public.payment_status else payment_status end where id = o.id;
    delete from public.order_rider_location where order_id = o.id;
    perform public.notify(o.customer_id, 'Order ' || o.number, 'Delivered. Enjoy your meal!', o.id);
  else
    perform public.fail('INVALID_TRANSITION', 'Unknown step.');
  end if;
  insert into public.order_events (order_id, actor_id, actor_role, event, from_status, to_status, note)
    values (o.id, p_rider, 'rider', 'delivery_' || p_status, o.status, null, null);
  return 'ok';
end $$;

create function public.rider_failed(p_order uuid, p_rider uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders%rowtype;
begin
  if public.actor_role(p_rider) is distinct from 'rider' then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
  select * into o from public.orders where id = p_order and rider_id = p_rider and status in ('picked_up','out_for_delivery');
  if not found then perform public.fail('NOT_FOUND', 'Assignment not found.'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then perform public.fail('REASON_REQUIRED', 'Please say what went wrong.'); end if;
  insert into public.order_events (order_id, actor_id, actor_role, event, note) values (o.id, p_rider, 'rider', 'delivery_failed', left(p_reason, 300));
  perform public.notify_staff('Delivery problem: ' || o.number, left(p_reason, 200), o.id);
end $$;

create function public.record_rider_location(p_order uuid, p_rider uuid, p_lat numeric, p_lng numeric, p_recorded_at timestamptz)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev timestamptz;
begin
  if public.actor_role(p_rider) is distinct from 'rider' then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    perform public.fail('INVALID_ADDRESS', 'Invalid coordinates.');
  end if;
  if p_recorded_at is null or p_recorded_at < now() - interval '2 minutes' or p_recorded_at > now() + interval '30 seconds' then
    perform public.fail('STALE_LOCATION', 'The location is too old.');
  end if;
  perform 1 from public.orders where id = p_order and rider_id = p_rider and status not in ('delivered','cancelled');
  if not found then perform public.fail('NOT_FOUND', 'Assignment not found.'); end if;
  select updated_at into v_prev from public.order_rider_location where order_id = p_order;
  if v_prev is not null and v_prev > now() - interval '3 seconds' then perform public.fail('RATE_LIMITED', 'Too many updates.'); end if;
  insert into public.order_rider_location (order_id, rider_id, lat, lng, recorded_at) values (p_order, p_rider, p_lat, p_lng, p_recorded_at)
    on conflict (order_id) do update set rider_id = excluded.rider_id, lat = excluded.lat, lng = excluded.lng,
      recorded_at = excluded.recorded_at, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------------------------
-- Refunds and cash
-- ---------------------------------------------------------------------------------------------
create function public.request_refund(p_order uuid, p_actor uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders%rowtype; v_id uuid;
begin
  if public.actor_role(p_actor) is distinct from 'owner' then perform public.fail('FORBIDDEN', 'Only the owner can refund.'); end if;
  select * into o from public.orders where id = p_order for update;
  if not found then perform public.fail('NOT_FOUND', 'Order not found.'); end if;
  if o.payment_status <> 'paid' then perform public.fail('NOT_REFUNDABLE', 'This order has no payment to refund.'); end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then perform public.fail('REASON_REQUIRED', 'Please give a reason.'); end if;
  insert into public.refunds (order_id, amount, reason, requested_by) values (o.id, o.total, left(p_reason, 300), p_actor) returning id into v_id;
  update public.orders set payment_status = 'refund_pending' where id = o.id;
  insert into public.order_events (order_id, actor_id, actor_role, event, note) values (o.id, p_actor, 'owner', 'refund_requested', left(p_reason, 300));
  perform public.notify(o.customer_id, 'Refund requested', 'A refund for order ' || o.number || ' is being processed.', o.id);
  return v_id;
end $$;

-- Call when the provider (or the owner, for cash) confirms the money went back. p_actor is null for the webhook.
create function public.complete_refund(p_refund uuid, p_actor uuid, p_provider_ref text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare rf public.refunds%rowtype;
begin
  if p_actor is not null and public.actor_role(p_actor) is distinct from 'owner' then perform public.fail('FORBIDDEN', 'Only the owner can do this.'); end if;
  select * into rf from public.refunds where id = p_refund and status = 'requested' for update;
  if not found then perform public.fail('NOT_FOUND', 'No open refund found.'); end if;
  update public.refunds set status = 'completed', provider_refund_id = p_provider_ref, completed_at = now() where id = rf.id;
  update public.orders set payment_status = 'refunded' where id = rf.order_id;
  insert into public.order_events (order_id, actor_id, event, note) values (rf.order_id, p_actor, 'refund_completed', p_provider_ref);
end $$;

create function public.reconcile_cod(p_order uuid, p_actor uuid, p_amount numeric default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders%rowtype;
begin
  if public.actor_role(p_actor) is distinct from 'owner' then perform public.fail('FORBIDDEN', 'Only the owner can reconcile cash.'); end if;
  select * into o from public.orders where id = p_order for update;
  if not found then perform public.fail('NOT_FOUND', 'Order not found.'); end if;
  if o.payment_method <> 'cod' or o.status <> 'delivered' or o.payment_status <> 'paid' then
    perform public.fail('INVALID_TRANSITION', 'Only delivered cash orders can be reconciled.');
  end if;
  if exists (select 1 from public.cod_reconciliations where order_id = o.id) then perform public.fail('ALREADY_RECONCILED', 'Already reconciled.'); end if;
  insert into public.cod_reconciliations (order_id, amount, reconciled_by) values (o.id, coalesce(p_amount, o.total), p_actor);
  insert into public.order_events (order_id, actor_id, actor_role, event, note) values (o.id, p_actor, 'owner', 'cod_reconciled', coalesce(p_amount, o.total)::text);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reviews and support
-- ---------------------------------------------------------------------------------------------
create function public.submit_review(p_order uuid, p_customer uuid, p_rating int, p_comment text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders%rowtype; v_id uuid;
begin
  if public.actor_role(p_customer) is null then perform public.fail('ACCOUNT_DISABLED', 'This account is disabled.'); end if;
  if p_rating is null or p_rating not between 1 and 5 then perform public.fail('INVALID_RATING', 'Choose 1 to 5 stars.'); end if;
  select * into o from public.orders where id = p_order and customer_id = p_customer;
  if not found then perform public.fail('NOT_FOUND', 'Order not found.'); end if;
  if o.status <> 'delivered' then perform public.fail('NOT_DELIVERED', 'You can review an order after it is delivered.'); end if;
  begin
    insert into public.reviews (order_id, customer_id, rating, comment) values (o.id, p_customer, p_rating, left(coalesce(p_comment, ''), 1000))
      returning id into v_id;
  exception when unique_violation then
    perform public.fail('ALREADY_REVIEWED', 'You already reviewed this order.');
  end;
  perform public.refresh_food_ratings(o.id);
  perform public.notify_staff('New review', 'Order ' || o.number || ' was rated ' || p_rating || ' stars.', o.id);
  return v_id;
end $$;

create function public.respond_review(p_review uuid, p_actor uuid, p_message text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare rv public.reviews%rowtype;
begin
  if public.actor_role(p_actor) is distinct from 'owner' then perform public.fail('FORBIDDEN', 'Only the owner can respond.'); end if;
  if char_length(trim(coalesce(p_message, ''))) < 2 then perform public.fail('REASON_REQUIRED', 'Write a reply.'); end if;
  update public.reviews set owner_response = left(p_message, 1000), responded_by = p_actor, responded_at = now() where id = p_review returning * into rv;
  if not found then perform public.fail('NOT_FOUND', 'Review not found.'); end if;
  perform public.notify(rv.customer_id, 'The restaurant replied to your review', left(p_message, 200), rv.order_id);
end $$;

create function public.create_support_ticket(p_customer uuid, p_subject text, p_message text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_number text;
begin
  if public.actor_role(p_customer) is null then perform public.fail('ACCOUNT_DISABLED', 'This account is disabled.'); end if;
  if (select count(*) from public.support_tickets where customer_id = p_customer and status = 'open') >= 5 then
    perform public.fail('SUPPORT_LIMIT', 'Please wait for replies to your open requests.');
  end if;
  v_number := 'TK-' || lpad(nextval('public.ticket_number_seq')::text, 5, '0');
  insert into public.support_tickets (number, customer_id, subject, message) values (v_number, p_customer, trim(p_subject), trim(p_message)) returning id into v_id;
  perform public.notify_staff('New support request ' || v_number, left(trim(p_subject), 100), null);
  return v_id;
end $$;

create function public.respond_support(p_ticket uuid, p_actor uuid, p_message text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.support_tickets%rowtype;
begin
  if public.actor_role(p_actor) is distinct from 'owner' then perform public.fail('FORBIDDEN', 'Only the owner can respond.'); end if;
  if char_length(trim(coalesce(p_message, ''))) < 2 then perform public.fail('REASON_REQUIRED', 'Write a reply.'); end if;
  update public.support_tickets set response = left(p_message, 2000), responded_by = p_actor, responded_at = now(), status = 'answered'
    where id = p_ticket returning * into t;
  if not found then perform public.fail('NOT_FOUND', 'Request not found.'); end if;
  perform public.notify(t.customer_id, 'Reply to ' || t.number, left(p_message, 200), null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Analytics. period: daily (today, 24 hourly buckets) | weekly (7 days) | monthly (30 days). Cancelled orders excluded.
-- netRevenue = gross food sales - discounts - refunds. Taxes and delivery charges are reported separately.
-- ---------------------------------------------------------------------------------------------
create function public.owner_analytics(p_actor uuid, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_tz text; v_start timestamptz; v_step interval; v_buckets int; v_today timestamp;
  v_orders int; v_gross numeric; v_disc numeric; v_tax numeric; v_fee numeric; v_ref numeric; v_pending int; v_done int; v_daily jsonb;
begin
  if public.actor_role(p_actor) not in ('owner','manager') then perform public.fail('FORBIDDEN', 'Not allowed.'); end if;
  select timezone into v_tz from public.restaurant;
  v_today := date_trunc('day', now() at time zone v_tz);
  case lower(coalesce(p_period, 'daily'))
    when 'daily'   then v_start := v_today at time zone v_tz;                          v_step := interval '1 hour'; v_buckets := 24;
    when 'weekly'  then v_start := (v_today - interval '6 days') at time zone v_tz;    v_step := interval '1 day';  v_buckets := 7;
    when 'monthly' then v_start := (v_today - interval '29 days') at time zone v_tz;   v_step := interval '1 day';  v_buckets := 30;
    else perform public.fail('INVALID_ITEM', 'Unknown period.');
  end case;

  select count(*) filter (where status <> 'cancelled'),
         coalesce(sum(subtotal) filter (where status <> 'cancelled'), 0),
         coalesce(sum(discount) filter (where status <> 'cancelled'), 0),
         coalesce(sum(tax) filter (where status <> 'cancelled'), 0),
         coalesce(sum(delivery_fee) filter (where status <> 'cancelled'), 0),
         count(*) filter (where status not in ('delivered','cancelled')),
         count(*) filter (where status = 'delivered')
    into v_orders, v_gross, v_disc, v_tax, v_fee, v_pending, v_done
    from public.orders where created_at >= v_start;
  select coalesce(sum(rf.amount), 0) into v_ref from public.refunds rf join public.orders o on o.id = rf.order_id
    where rf.created_at >= v_start and rf.status in ('requested','completed') and o.status <> 'cancelled';
  select coalesce(jsonb_agg(c order by i), '[]'::jsonb) into v_daily from (
    select g.i, (select count(*) from public.orders o where o.status <> 'cancelled'
                   and o.created_at >= v_start + g.i * v_step and o.created_at < v_start + (g.i + 1) * v_step) as c
    from generate_series(0, v_buckets - 1) g(i)) b;

  return jsonb_build_object('orders', v_orders, 'grossSales', v_gross, 'discounts', v_disc, 'taxes', v_tax,
    'deliveryCharges', v_fee, 'refunds', v_ref, 'netRevenue', v_gross - v_disc - v_ref,
    'pending', v_pending, 'completed', v_done, 'daily', v_daily);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Lock these functions to the service role. Browsers and phones must never call them directly.
-- (auth_role / is_kitchen_staff / is_owner from the first migration stay callable: policies use them.)
-- ---------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'fail','actor_role','notify','notify_staff','refresh_food_ratings','order_json','list_orders','place_order',
      'create_payment_record','record_payment_captured','change_order_status','owner_set_preparation','assign_rider',
      'rider_update','rider_failed','record_rider_location','request_refund','complete_refund','reconcile_cod',
      'submit_review','respond_review','create_support_ticket','respond_support','owner_analytics')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
