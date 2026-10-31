// Owner only: restaurant settings, coupons, refunds, cash, records and reports.
import { HttpError, Role, Row, bad, bool, coords, num, obj, optStr, phone, str, uuid, httpsUrl } from '../lib.ts';
import type { Router } from '../handler.ts';
import { couponJson, loadRestaurant } from '../queries.ts';

const OWNER: Role[] = ['owner'];
const recordLimit = 500;

function parseHours(x: unknown): { opens: string | null; closes: string | null } {
  if (x === '' || x === null) return { opens: null, closes: null };
  const m = /^\s*(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})\s*$/.exec(String(x));
  if (!m) throw bad('Write the hours like 11:00–23:00.');
  const t = (h: string, mi: string) => { const hh = Number(h), mm = Number(mi); if (hh > 23 || mm > 59) throw bad('Those hours are not valid.'); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  const opens = t(m[1], m[2]), closes = t(m[3], m[4]);
  if (opens === closes) throw bad('Opening and closing time must be different.');
  return { opens, closes };
}
function parseHolidays(x: unknown): string[] {
  if (x === '' || x === null) return [];
  const parts = String(x).split(/[,\s]+/).filter(Boolean);
  if (parts.length > 60) throw bad('Too many holiday dates.');
  for (const p of parts) if (!/^\d{4}-\d{2}-\d{2}$/.test(p) || Number.isNaN(Date.parse(p))) throw bad(`"${p}" is not a date. Use YYYY-MM-DD, separated by commas.`);
  return [...new Set(parts)].sort();
}
/** Spreadsheet programs run cells starting with = + - @ as formulas. Neutralise them, then quote. */
const csvCell = (v: unknown) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function ownerRoutes(r: Router) {
  // ---- settings
  r.add('PATCH', '/owner/restaurant', OWNER, async (c) => {
    const b = obj(await c.json());
    const [cur] = await c.sql`select name, phone, address, branding_image, lat, lng, is_open, delivery_fee, tax_rate, minimum_order, preparation_minutes, delivery_radius_km,
      to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes,
      coalesce((select json_agg(to_char(d, 'YYYY-MM-DD') order by d) from unnest(holidays) d), '[]'::json) as holidays from public.restaurant`;
    const name = b.name === undefined ? cur.name : str(b.name, 'Restaurant name', { min: 2, max: 80 });
    const ph = b.phone === undefined ? cur.phone : b.phone === '' ? '' : phone(b.phone);
    const address = b.address === undefined ? cur.address : optStr(b.address, 'Address', { max: 300 });
    let branding = cur.branding_image;
    if (b.brandingImage !== undefined) { branding = httpsUrl(b.brandingImage, 'Branding image'); if (branding === '' && String(b.brandingImage).trim() !== '') throw bad('The branding image must be a link starting with https://'); }
    const loc = b.location === undefined ? { lat: cur.lat, lng: cur.lng } : coords(b.location, 'Restaurant');
    const open = b.open === undefined ? cur.is_open : bool(b.open, 'Open');
    const fee = b.deliveryFee === undefined ? cur.delivery_fee : num(b.deliveryFee, 'Delivery fee', { min: 0, max: 5000 });
    const tax = b.taxRate === undefined ? cur.tax_rate : num(b.taxRate, 'Tax rate', { min: 0, max: 0.5 });
    const minimum = b.minimumOrder === undefined ? cur.minimum_order : num(b.minimumOrder, 'Minimum order', { min: 0, max: 100000 });
    const prep = b.preparationMinutes === undefined ? cur.preparation_minutes : num(b.preparationMinutes, 'Preparation time', { int: true, min: 1, max: 240 });
    const radius = b.radius === undefined ? cur.delivery_radius_km : num(b.radius, 'Delivery radius', { min: 0.1, max: 50 });
    const hours = b.hours === undefined ? { opens: cur.opens, closes: cur.closes } : parseHours(b.hours);
    const holidays = b.holidays === undefined ? cur.holidays : parseHolidays(b.holidays);
    if (open && loc.lat === 0 && loc.lng === 0) throw bad('Set the restaurant location before opening for orders.');
    await c.sql`update public.restaurant set name = ${name}, phone = ${ph}, address = ${address}, branding_image = ${branding}, lat = ${loc.lat}, lng = ${loc.lng},
      is_open = ${open}, delivery_fee = ${fee}, tax_rate = ${tax}, minimum_order = ${minimum}, preparation_minutes = ${prep}, delivery_radius_km = ${radius},
      opens_at = ${hours.opens}::time, closes_at = ${hours.closes}::time,
      holidays = (select coalesce(array_agg(d::date), '{}') from jsonb_array_elements_text(${JSON.stringify(holidays)}::text::jsonb) d)`;
    await c.sql`insert into public.audit_log (actor_id, action, entity, details) values (${c.me().id}::uuid, 'settings.update', 'restaurant', ${JSON.stringify({ fields: Object.keys(b) })}::text::jsonb)`;
    return loadRestaurant(c.sql, true);
  });

  // ---- coupons
  r.add('GET', '/owner/coupons', OWNER, async (c) => (await c.sql`select * from public.coupons order by created_at desc`).map(couponJson));
  r.add('POST', '/owner/coupons', OWNER, async (c) => {
    const b = obj(await c.json());
    const code = str(b.code, 'Coupon code', { min: 3, max: 24 }).toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw bad('Use only letters, numbers, - and _ in the coupon code.');
    if (b.type !== 'fixed' && b.type !== 'percentage') throw bad('Choose a fixed or percentage coupon.');
    const value = num(b.value, 'Coupon value', { min: 0.01, max: b.type === 'percentage' ? 100 : 100000 });
    const minimum = b.minimum == null || b.minimum === '' ? 0 : num(b.minimum, 'Minimum order', { min: 0, max: 100000 });
    const maxDiscount = b.maxDiscount == null || b.maxDiscount === '' ? (b.type === 'fixed' ? value : NaN) : num(b.maxDiscount, 'Maximum discount', { min: 0.01, max: 100000 });
    if (!Number.isFinite(maxDiscount)) throw bad('Set the maximum discount for a percentage coupon.');
    if (b.type === 'fixed' && maxDiscount < value) throw bad('The maximum discount cannot be lower than the coupon value.');
    const title = optStr(b.title, 'Title', { max: 60 }) || code;
    const [row] = await c.sql`insert into public.coupons (code, title, description, kind, value, minimum_order, max_discount)
      values (${code}, ${title}, ${optStr(b.description, 'Description', { max: 200 })}, ${b.type}::public.coupon_kind, ${value}, ${minimum}, ${maxDiscount})
      on conflict (code) do update set title = excluded.title, description = excluded.description, kind = excluded.kind, value = excluded.value,
        minimum_order = excluded.minimum_order, max_discount = excluded.max_discount, active = true returning *`;
    return c.reply(couponJson(row), 201);
  });

  // ---- money
  r.add('POST', '/owner/orders/:id/refund', OWNER, async (c) => {
    const id = uuid(c.params.id); const b = await c.json(); const me = c.me().id;
    await c.sql`select public.request_refund(${id}::uuid, ${me}::uuid, ${str(b.reason, 'Reason', { min: 3, max: 300 })})`;
    const [row] = await c.sql`select public.order_json(${id}::uuid, ${me}::uuid) as o`;
    return row.o;
  });
  r.add('POST', '/owner/refunds/:id/complete', OWNER, async (c) => {
    const b = await c.json();
    await c.sql`select public.complete_refund(${uuid(c.params.id)}::uuid, ${c.me().id}::uuid, ${optStr(b.reference, 'Reference', { max: 100 }) || 'manual'})`;
    return { ok: true };
  });
  r.add('POST', '/owner/orders/:id/cod-reconciliation', OWNER, async (c) => {
    const b = await c.json();
    const amount = b.amount === undefined ? null : num(b.amount, 'Amount', { min: 0, max: 1000000 });
    await c.sql`select public.reconcile_cod(${uuid(c.params.id)}::uuid, ${c.me().id}::uuid, ${amount})`;
    return { ok: true };
  });

  // ---- records (the tabs on the owner "Records" screen)
  r.add('GET', '/owner/customers', OWNER, async (c) => (await c.sql`
    select p.id, p.name, p.email, p.created_at, count(o.id) filter (where o.status <> 'cancelled')::int as order_count,
           coalesce(sum(o.total) filter (where o.status <> 'cancelled'), 0) as total
    from public.profiles p left join public.orders o on o.customer_id = p.id
    where p.role = 'customer' group by p.id order by order_count desc, p.created_at desc limit ${recordLimit}`)
    .map((x) => ({ id: x.id, name: x.name, email: x.email, orderCount: x.order_count, total: x.total, createdAt: x.created_at })));
  r.add('GET', '/owner/payments', OWNER, async (c) => (await c.sql`
    select o.id, o.number, p.name, o.payment_method::text as method, o.payment_status::text as pstatus, o.total, o.created_at
    from public.orders o join public.profiles p on p.id = o.customer_id where o.status <> 'cancelled' or o.payment_status <> 'pending'
    order by o.created_at desc limit ${recordLimit}`)
    .map((x) => ({ id: x.id, number: x.number, name: x.name, status: `${x.method === 'cod' ? 'Cash' : 'Online'} · ${x.pstatus.replace('_', ' ')}`, total: x.total, createdAt: x.created_at })));
  r.add('GET', '/owner/refunds', OWNER, async (c) => (await c.sql`
    select rf.id, o.number, rf.status::text as status, rf.amount, rf.reason, rf.created_at from public.refunds rf join public.orders o on o.id = rf.order_id
    order by rf.created_at desc limit ${recordLimit}`)
    .map((x) => ({ id: x.id, number: x.number, status: x.status, total: x.amount, message: x.reason, createdAt: x.created_at })));
  r.add('GET', '/owner/reviews', OWNER, async (c) => (await c.sql`
    select rv.id, o.number, p.name, rv.rating, rv.comment, rv.owner_response, rv.created_at from public.reviews rv
    join public.orders o on o.id = rv.order_id join public.profiles p on p.id = rv.customer_id order by rv.created_at desc limit ${recordLimit}`)
    .map((x) => ({ id: x.id, number: x.number, name: x.name, title: `${x.rating} / 5`, message: x.comment, status: x.owner_response ? 'answered' : 'new', createdAt: x.created_at })));
  r.add('GET', '/owner/support', OWNER, async (c) => (await c.sql`
    select t.id, t.number, p.name, p.email, t.subject, t.message, t.status::text as status, t.created_at from public.support_tickets t
    join public.profiles p on p.id = t.customer_id order by t.created_at desc limit ${recordLimit}`)
    .map((x) => ({ id: x.id, number: x.number, name: x.name, email: x.email, title: x.subject, message: x.message, status: x.status, createdAt: x.created_at })));
  r.add('GET', '/owner/delivery-history', OWNER, async (c) => (await c.sql`
    select o.id, o.number, coalesce(rd.name, 'Restaurant') as rider, o.total, o.delivered_at from public.orders o left join public.profiles rd on rd.id = o.rider_id
    where o.status = 'delivered' order by o.delivered_at desc limit ${recordLimit}`)
    .map((x) => ({ id: x.id, number: x.number, name: x.rider, status: 'delivered', total: x.total, createdAt: x.delivered_at })));
  r.add('POST', '/owner/reviews/:id/response', OWNER, async (c) => {
    const b = await c.json();
    await c.sql`select public.respond_review(${uuid(c.params.id)}::uuid, ${c.me().id}::uuid, ${str(b.message, 'Reply', { min: 2, max: 1000 })})`;
    return { ok: true };
  });
  r.add('POST', '/owner/support/:id/response', OWNER, async (c) => {
    const b = await c.json();
    await c.sql`select public.respond_support(${uuid(c.params.id)}::uuid, ${c.me().id}::uuid, ${str(b.message, 'Reply', { min: 2, max: 2000 })})`;
    return { ok: true };
  });

  // ---- reports
  r.add('GET', '/owner/reports', OWNER, async (c) => {
    const period = (c.url.searchParams.get('period') ?? 'monthly').toLowerCase();
    const days = ({ daily: 1, weekly: 7, monthly: 30 } as Record<string, number>)[period];
    if (!days) throw bad('Choose daily, weekly or monthly.');
    const rows = await c.sql`
      select o.number, o.created_at, o.status::text as status, o.payment_method::text as payment, o.payment_status::text as payment_status,
             o.subtotal, o.discount, o.tax, o.delivery_fee, o.total, coalesce(o.coupon_code, '') as coupon, p.name as customer
      from public.orders o join public.profiles p on p.id = o.customer_id
      where o.created_at >= (date_trunc('day', now() at time zone (select timezone from public.restaurant)) - make_interval(days => ${days - 1})) at time zone (select timezone from public.restaurant)
      order by o.created_at`;
    const head = ['Order', 'Placed at', 'Status', 'Payment', 'Payment status', 'Subtotal', 'Discount', 'Tax', 'Delivery fee', 'Total', 'Coupon', 'Customer'];
    const lines = rows.map((x: Row) => [x.number, x.created_at, x.status, x.payment, x.payment_status, x.subtotal, x.discount, x.tax, x.delivery_fee, x.total, x.coupon, x.customer].map(csvCell).join(','));
    return { csv: [head.join(','), ...lines].join('\n') };
  });
}
void HttpError;
