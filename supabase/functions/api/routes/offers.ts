// The owner's offer messages to customers: an in-app inbox message for everyone who allows offers, plus a phone notification when push is set up.
import { Role, str, optStr, Row } from '../lib.ts';
import type { Router } from '../handler.ts';

const OWNER: Role[] = ['owner'];

export function offerRoutes(r: Router) {
  r.add('GET', '/owner/offers/audience', OWNER, async (c) => {
    const [a] = await c.sql`select
      (select count(*) from public.profiles where role = 'customer' and active)::int as customers,
      (select count(*) from public.profiles where role = 'customer' and active and marketing_opt_in)::int as opted_in,
      (select count(*) from public.push_tokens t join public.profiles p on p.id = t.user_id where p.role = 'customer' and p.active and p.marketing_opt_in)::int as devices`;
    return { customers: a.customers, optedIn: a.opted_in, devices: a.devices, pushConfigured: !!c.env.push?.configured };
  });

  r.add('GET', '/owner/offers/broadcasts', OWNER, async (c) => (await c.sql`
    select id, title, body, coupon_code, recipients, push_sent, push_failed, created_at from public.offer_broadcasts order by created_at desc limit 30`)
    .map((x: Row) => ({ id: x.id, title: x.title, message: x.body, couponCode: x.coupon_code ?? undefined, recipients: x.recipients, pushSent: x.push_sent, pushFailed: x.push_failed, createdAt: x.created_at })));

  r.add('POST', '/owner/offers/broadcast', OWNER, async (c) => {
    c.limit('broadcast', 6);
    const b = await c.json(); const me = c.me().id;
    const title = str(b.title, 'Title', { min: 3, max: 60 }); const message = str(b.message, 'Message', { min: 5, max: 240 });
    const coupon = optStr(b.couponCode, 'Coupon', { max: 24 }) || null;
    const [row] = await c.sql`select public.broadcast_offer(${me}::uuid, ${title}, ${message}, ${coupon}) as result`;
    const { id, recipients } = row.result as { id: string; recipients: number };
    let pushSent = 0, pushFailed = 0; const pushConfigured = !!c.env.push?.configured;
    if (pushConfigured) {
      const devices = await c.sql`select t.token from public.push_tokens t join public.profiles p on p.id = t.user_id
        where p.role = 'customer' and p.active and p.marketing_opt_in`;
      try {
        const out = await c.env.push!.send(devices.map((d: Row) => d.token), { title, body: message, data: { type: 'offer', ...(coupon ? { coupon } : {}) } });
        pushSent = out.sent; pushFailed = out.failed;
        if (out.invalid.length) await c.sql`delete from public.push_tokens where token in (select jsonb_array_elements_text(${JSON.stringify(out.invalid)}::text::jsonb))`;
      } catch (e) {
        pushFailed = devices.length;
        console.error(JSON.stringify({ requestId: c.requestId, level: 'error', event: 'push_failed', message: String((e as Error)?.message ?? e).slice(0, 200) }));
      }
      await c.sql`update public.offer_broadcasts set push_sent = ${pushSent}, push_failed = ${pushFailed} where id = ${id}::uuid`;
    }
    await c.sql`insert into public.audit_log (actor_id, action, entity, entity_id, details) values (${me}::uuid, 'offer.broadcast', 'offer_broadcasts', ${id}, ${JSON.stringify({ recipients, pushSent, pushFailed })}::text::jsonb)`;
    return c.reply({ id, recipients, pushSent, pushFailed, pushConfigured }, 201);
  });
}
