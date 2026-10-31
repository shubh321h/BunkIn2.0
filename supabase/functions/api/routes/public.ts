import type { Router } from '../handler.ts';
import { couponJson, loadFoods, loadRestaurant } from '../queries.ts';

export const isKitchen = (u: { role: string } | null) => !!u && (u.role === 'owner' || u.role === 'manager');

export function publicRoutes(r: Router) {
  r.add('GET', '/health', 'public', async () => ({ ok: true }));
  // The menu and restaurant are public. Signed-in kitchen staff also get stock counts and hidden dishes.
  r.add('GET', '/menu', 'optional', (c) => loadFoods(c.sql, isKitchen(c.user)));
  r.add('GET', '/restaurant', 'optional', (c) => loadRestaurant(c.sql, isKitchen(c.user)));
  r.add('GET', '/offers', 'public', async (c) => {
    const rows = await c.sql`select * from public.coupons
      where active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
      order by value desc, code`;
    return rows.map(couponJson);
  });
}
