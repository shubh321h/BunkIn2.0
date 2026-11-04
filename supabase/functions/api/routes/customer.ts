import { HttpError, Row, bad, bool, coords, isUuid, num, obj, optStr, phone, str, uuid } from '../lib.ts';
import type { Ctx, Router } from '../handler.ts';
import { crossCheckServiceArea, digits } from '../serviceArea.ts';

const profileJson = (p: Row) => ({ id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role, mustChangePassword: p.must_change_password, marketingOptIn: p.marketing_opt_in });
const addressJson = (a: Row) => ({ id: a.id, label: a.label, line: a.line, area: a.area, city: a.city, pincode: a.pincode, contact: a.contact, phone: a.phone, location: { lat: a.lat, lng: a.lng } });
const pincodeOf = (x: unknown) => { const p = digits(x); if (!/^\d{6}$/.test(p)) throw bad('Enter the 6-digit PIN code of this address.', 'INVALID_ADDRESS'); return p; };

async function orderFor(c: Ctx, id: string) {
  const [row] = await c.sql`select public.order_json(${id}::uuid, ${c.me().id}::uuid) as o`;
  if (!row?.o) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
  return row.o;
}

export function customerRoutes(r: Router) {
  // ---- account
  r.add('GET', '/me', 'user', async (c) => {
    const [p] = await c.sql`select id, name, email, phone, role::text as role, must_change_password, marketing_opt_in from public.profiles where id = ${c.me().id}::uuid`;
    return profileJson(p);
  });
  r.add('PATCH', '/me', 'user', async (c) => {
    const b = await c.json();
    const name = b.name === undefined ? null : str(b.name, 'Name', { min: 2, max: 80 });
    const ph = b.phone === undefined || b.phone === '' ? null : phone(b.phone);
    const marketing = b.marketingOptIn === undefined ? null : bool(b.marketingOptIn, 'Offers');
    const [p] = await c.sql`update public.profiles set name = coalesce(${name}, name), phone = coalesce(${ph}, phone), marketing_opt_in = coalesce(${marketing}, marketing_opt_in)
      where id = ${c.me().id}::uuid returning id, name, email, phone, role::text as role, must_change_password, marketing_opt_in`;
    if (marketing === false) await c.sql`delete from public.push_tokens where user_id = ${c.me().id}::uuid`;   // offers off: forget this person's devices
    return profileJson(p);
  });

  // ---- phone notifications: a device registers its token so the restaurant can send offers
  r.add('POST', '/me/push-token', 'user', async (c) => {
    c.limit('push-token', 20);
    const b = await c.json(); const me = c.me().id;
    const token = str(b.token, 'Device token', { min: 20, max: 4096 });
    if (/\s/.test(token)) throw bad('That device token is not valid.');
    const platform = b.platform === 'ios' || b.platform === 'web' ? b.platform : 'android';
    await c.sql`insert into public.push_tokens (token, user_id, platform) values (${token}, ${me}::uuid, ${platform})
      on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen = now()`;
    await c.sql`delete from public.push_tokens where user_id = ${me}::uuid and token not in (select token from public.push_tokens where user_id = ${me}::uuid order by last_seen desc limit 5)`;
    return c.reply({ ok: true }, 201);
  });
  r.add('POST', '/me/push-token/remove', 'user', async (c) => {
    const b = await c.json();
    await c.sql`delete from public.push_tokens where token = ${str(b.token, 'Device token', { min: 20, max: 4096 })} and user_id = ${c.me().id}::uuid`;
    return { ok: true };
  });

  // ---- addresses
  r.add('GET', '/me/addresses', 'user', async (c) => {
    const rows = await c.sql`select * from public.addresses where user_id = ${c.me().id}::uuid order by created_at desc`;
    return rows.map(addressJson);
  });
  r.add('POST', '/me/addresses', 'user', async (c) => {
    const b = await c.json();
    const label = optStr(b.label, 'Label', { max: 30 }) || 'Home';
    const line = str(b.line, 'Address', { min: 5, max: 200 });
    const area = optStr(b.area, 'Area', { max: 120 });
    const contact = str(b.contact, 'Contact name', { min: 2, max: 80 });
    const ph = phone(b.phone, 'Contact phone');
    const { lat, lng } = coords(b.location, 'Delivery');
    const pin = pincodeOf(b.pincode); const city = optStr(b.city, 'City', { max: 80 });
    const me = c.me().id;
    // An address we cannot deliver to is never saved, so it can never be picked at checkout.
    await c.sql`select public.assert_service_area(${lat}, ${lng}, ${pin})`;
    await crossCheckServiceArea(c.sql, c.env, lat, lng, c.requestId);
    if (isUuid(b.id)) {
      const [a] = await c.sql`update public.addresses set label = ${label}, line = ${line}, area = ${area}, city = ${city}, pincode = ${pin}, contact = ${contact}, phone = ${ph}, lat = ${lat}, lng = ${lng}
        where id = ${b.id}::uuid and user_id = ${me}::uuid returning *`;
      if (a) return addressJson(a);
    }
    const [a] = await c.sql`insert into public.addresses (user_id, label, line, area, city, pincode, contact, phone, lat, lng)
      values (${me}::uuid, ${label}, ${line}, ${area}, ${city}, ${pin}, ${contact}, ${ph}, ${lat}, ${lng}) returning *`;
    return c.reply(addressJson(a), 201);
  });
  r.add('DELETE', '/me/addresses/:id', 'user', async (c) => {
    await c.sql`delete from public.addresses where id = ${uuid(c.params.id)}::uuid and user_id = ${c.me().id}::uuid`;
    return c.reply({}, 204);
  });

  // ---- notifications
  r.add('GET', '/me/notifications', 'user', async (c) => {
    const rows = await c.sql`select id, title, body, read from public.notifications where user_id = ${c.me().id}::uuid order by created_at desc limit 50`;
    return rows.map((n) => ({ id: n.id, title: n.title, body: n.body, read: n.read }));
  });
  r.add('POST', '/me/notifications/read', 'user', async (c) => {
    await c.sql`update public.notifications set read = true where user_id = ${c.me().id}::uuid and not read`;
    return { ok: true };
  });

  // ---- orders
  r.add('GET', '/orders', 'user', async (c) => {
    const rows = await c.sql`select * from public.list_orders(${c.me().id}::uuid, 'mine')`;
    return rows.map((x) => x.list_orders);
  });
  r.add('GET', '/orders/:id', 'user', async (c) => orderFor(c, uuid(c.params.id)));

  r.add('POST', '/checkout', 'user', async (c) => {
    c.limit('checkout', c.env.checkoutsPerMinute ?? 10);
    const b = await c.json();
    const payment = b.payment;
    if (payment !== 'cod' && payment !== 'online') throw bad('Choose cash on delivery or online payment.');
    if (payment === 'online' && !c.env.onlinePayments) throw new HttpError(400, 'Online payment is not available yet. Please choose cash on delivery.', 'ONLINE_UNAVAILABLE');
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 30) throw bad('Your cart is empty or too large.', 'EMPTY_CART');
    const items = b.items.map((raw: unknown) => {
      const i = obj(raw);
      if (!isUuid(i.foodId) || !isUuid(i.variantId)) throw bad('A dish in your cart is no longer valid. Please refresh the menu.', 'INVALID_ITEM');
      const addonIds = Array.isArray(i.addonIds) ? i.addonIds : [];
      if (addonIds.length > 10 || addonIds.some((a: unknown) => !isUuid(a))) throw bad('An add-on in your cart is no longer valid.', 'INVALID_OPTION');
      return { foodId: i.foodId, variantId: i.variantId, quantity: num(i.quantity, 'Quantity', { int: true, min: 1, max: 20 }), addonIds,
        spice: optStr(i.spice, 'Spice level', { max: 30 }), instructions: optStr(i.instructions, 'Dish note', { max: 200 }) };
    });
    const a = obj(b.address);
    const address = { label: optStr(a.label, 'Label', { max: 30 }), line: str(a.line, 'Address', { min: 5, max: 200 }), area: optStr(a.area, 'Area', { max: 120 }),
      city: optStr(a.city, 'City', { max: 80 }), pincode: pincodeOf(a.pincode),
      contact: str(a.contact, 'Contact name', { min: 2, max: 80 }), phone: phone(a.phone, 'Contact phone'), location: coords(a.location, 'Delivery') };
    await crossCheckServiceArea(c.sql, c.env, address.location.lat, address.location.lng, c.requestId);   // place_order then enforces PIN + radius in the database
    const coupon = b.coupon ? str(b.coupon, 'Coupon', { max: 24 }).toUpperCase() : null;
    const instructions = optStr(b.instructions, 'Instructions', { max: 300 });
    const key = str(b.idempotencyKey, 'Order reference', { min: 8, max: 100 });
    const me = c.me().id;
    const [row] = await c.sql`select public.place_order(${me}::uuid, ${JSON.stringify(items)}::text::jsonb, ${JSON.stringify(address)}::text::jsonb,
      ${coupon}, ${payment}::public.payment_method, ${instructions}, ${key}) as id`;
    return c.reply({ order: await orderFor(c, row.id) }, 201);
  });

  r.add('POST', '/orders/:id/cancel', 'user', async (c) => {
    const id = uuid(c.params.id); const b = await c.json();
    const reason = optStr(b.reason, 'Reason', { max: 300 }) || 'Cancelled by customer';
    await c.sql`select public.change_order_status(${id}::uuid, 'cancelled', ${c.me().id}::uuid, ${reason})`;
    return orderFor(c, id);
  });
  r.add('POST', '/orders/:id/review', 'user', async (c) => {
    const id = uuid(c.params.id); const b = await c.json();
    const rating = num(b.rating, 'Rating', { int: true, min: 1, max: 5 });
    await c.sql`select public.submit_review(${id}::uuid, ${c.me().id}::uuid, ${rating}, ${optStr(b.comment, 'Comment', { max: 1000 })})`;
    return c.reply({ ok: true }, 201);
  });

  // ---- support
  r.add('POST', '/support', 'user', async (c) => {
    c.limit('support', 5);
    const b = await c.json();
    const [row] = await c.sql`select public.create_support_ticket(${c.me().id}::uuid, ${str(b.subject, 'Subject', { min: 3, max: 120 })}, ${str(b.message, 'Message', { min: 5, max: 2000 })}) as id`;
    return c.reply({ id: row.id }, 201);
  });
}
