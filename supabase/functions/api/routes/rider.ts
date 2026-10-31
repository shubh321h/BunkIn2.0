import { HttpError, bad, num, obj, optStr, str, uuid } from '../lib.ts';
import type { Ctx, Router } from '../handler.ts';

const STEPS = ['arriving_at_pickup', 'picked_up', 'out_for_delivery', 'delivered'];

export function riderRoutes(r: Router) {
  r.add('GET', '/rider/assignments', ['rider'], async (c) => {
    const rows = await c.sql`select * from public.list_orders(${c.me().id}::uuid, 'active')`;
    return rows.map((x) => x.list_orders);
  });
  r.add('GET', '/rider/history', ['rider'], async (c) => {
    const rows = await c.sql`select * from public.list_orders(${c.me().id}::uuid, 'history')`;
    return rows.map((x) => x.list_orders);
  });

  r.add('PATCH', '/rider/assignments/:id', ['rider'], async (c: Ctx) => {
    const id = uuid(c.params.id); const b = await c.json(); const me = c.me().id;
    if (!STEPS.includes(b.status)) throw bad('That delivery step is not valid.');
    if (b.status === 'delivered') c.limit('delivery-code', 30);
    const otp = b.otp === undefined || b.otp === null ? null : String(b.otp).trim();
    if (b.status === 'delivered' && (!otp || !/^\d{4,8}$/.test(otp))) throw bad('Enter the delivery code the customer gives you.');
    const [res] = await c.sql`select public.rider_update(${id}::uuid, ${me}::uuid, ${b.status}, ${otp}) as result`;
    if (res.result === 'OTP_INVALID') throw new HttpError(400, 'That delivery code is not correct. Ask the customer to check it.', 'OTP_INVALID');
    if (res.result === 'OTP_LOCKED') throw new HttpError(429, 'Too many wrong codes. Please contact the restaurant.', 'OTP_LOCKED');
    const [row] = await c.sql`select public.order_json(${id}::uuid, ${me}::uuid) as o`;
    return row.o;
  });

  r.add('POST', '/rider/assignments/:id/location', ['rider'], async (c) => {
    const id = uuid(c.params.id); const b = obj(await c.json());
    const lat = num(b.lat, 'Latitude', { min: -90, max: 90 }); const lng = num(b.lng, 'Longitude', { min: -180, max: 180 });
    const when = b.timestamp ? new Date(b.timestamp) : new Date();
    if (Number.isNaN(when.getTime())) throw bad('The location time is not valid.');
    await c.sql`select public.record_rider_location(${id}::uuid, ${c.me().id}::uuid, ${lat}, ${lng}, ${when.toISOString()}::timestamptz)`;
    return { ok: true };
  });

  r.add('POST', '/rider/assignments/:id/failed', ['rider'], async (c) => {
    const id = uuid(c.params.id); const b = await c.json();
    await c.sql`select public.rider_failed(${id}::uuid, ${c.me().id}::uuid, ${str(b.reason, 'Reason', { min: 3, max: 300 })})`;
    return { ok: true };
  });
}
