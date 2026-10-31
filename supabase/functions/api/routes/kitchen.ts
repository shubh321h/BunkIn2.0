// Owner AND manager: orders, menu, categories, riders, analytics.
import { HttpError, Role, Row, Tx, bad, bool, httpsUrl, isObj, isUuid, num, optStr, str, uuid } from '../lib.ts';
import type { Ctx, Router } from '../handler.ts';
import { loadFoods } from '../queries.ts';

const KITCHEN: Role[] = ['owner', 'manager'];
const ORDER_STATUSES = ['accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled'];

async function audit(tx: Tx, actor: string, action: string, entity: string, entityId: string | null, details: Row = {}) {
  await tx`insert into public.audit_log (actor_id, action, entity, entity_id, details) values (${actor}::uuid, ${action}, ${entity}, ${entityId}, ${JSON.stringify(details)}::text::jsonb)`;
}

export function kitchenRoutes(r: Router) {
  // ---- orders
  r.add('GET', '/owner/orders', KITCHEN, async (c) => {
    const rows = await c.sql`select * from public.list_orders(${c.me().id}::uuid, 'kitchen')`;
    return rows.map((x) => x.list_orders);
  });
  r.add('PATCH', '/owner/orders/:id', KITCHEN, async (c) => {
    const id = uuid(c.params.id); const b = await c.json(); const me = c.me().id;
    const status = b.status === undefined ? null : b.status;
    if (status !== null && !ORDER_STATUSES.includes(status)) throw bad('That status is not valid.');
    const prep = b.preparationMinutes === undefined ? null : num(b.preparationMinutes, 'Preparation time', { int: true, min: 1, max: 240 });
    const rider = b.riderId === undefined ? undefined : (b.riderId === null || b.riderId === 'owner' ? null : uuid(b.riderId));
    const reason = optStr(b.reason, 'Reason', { max: 300 }) || null;
    if (status === null && prep === null && rider === undefined) throw bad('There is nothing to change.');
    await c.sql.begin(async (tx) => {
      if (prep !== null) await tx`select public.owner_set_preparation(${id}::uuid, ${me}::uuid, ${prep})`;
      if (rider !== undefined) await tx`select public.assign_rider(${id}::uuid, ${me}::uuid, ${rider}::uuid)`;
      if (status !== null) await tx`select public.change_order_status(${id}::uuid, ${status}::public.order_status, ${me}::uuid, ${reason})`;
    });
    const [row] = await c.sql`select public.order_json(${id}::uuid, ${me}::uuid) as o`;
    if (!row?.o) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
    return row.o;
  });
  // A delivery stuck because the customer's code is locked or the rider reported a problem.
  r.add('POST', '/owner/orders/:id/resolve-delivery', KITCHEN, async (c) => {
    const id = uuid(c.params.id); const b = await c.json(); const me = c.me().id;
    if (b.outcome !== 'delivered' && b.outcome !== 'cancelled') throw bad('Choose delivered or cancelled.');
    await c.sql`select public.owner_resolve_delivery(${id}::uuid, ${me}::uuid, ${b.outcome}, ${str(b.note, 'Note', { min: 3, max: 300 })})`;
    const [row] = await c.sql`select public.order_json(${id}::uuid, ${me}::uuid) as o`;
    return row.o;
  });
  r.add('GET', '/owner/riders', KITCHEN, async (c) => c.sql`
    select p.id, p.name, not exists (select 1 from public.orders o where o.rider_id = p.id and o.status not in ('delivered','cancelled')) as available
    from public.profiles p where p.role = 'rider' and p.active order by p.name`);

  // ---- analytics
  r.add('GET', '/owner/analytics', KITCHEN, async (c) => {
    const period = (c.url.searchParams.get('period') ?? 'daily').toLowerCase();
    const [row] = await c.sql`select public.owner_analytics(${c.me().id}::uuid, ${period}) as a`;
    return row.a;
  });

  // ---- menu
  r.add('POST', '/owner/menu', KITCHEN, async (c) => {
    const b = await c.json(); const me = c.me().id;
    const name = str(b.name, 'Dish name', { min: 3, max: 80 });
    const description = optStr(b.description, 'Description', { max: 500 });
    const price = num(b.price, 'Price', { min: 0.01, max: 100000 });
    const original = b.originalPrice == null || b.originalPrice === '' ? null : num(b.originalPrice, 'Original price', { min: 0.01, max: 100000 });
    if (original !== null && original < price) throw bad('The original price must not be lower than the price.');
    const stock = b.stock == null || b.stock === '' ? null : num(b.stock, 'Stock', { int: true, min: 0, max: 100000 });
    const image = httpsUrl(b.image, 'Image');
    const veg = bool(b.veg, 'Veg'); const available = b.available === undefined ? true : bool(b.available, 'Available');
    const tag = optStr(b.tag, 'Tag', { max: 30 }) || null;
    const calories = b.calories == null || b.calories === '' ? 0 : num(b.calories, 'Calories', { int: true, min: 0, max: 10000 });
    const prepTime = optStr(b.prep, 'Preparation time', { max: 30 });
    const options = (list: unknown, what: string, min: number, max: number) => {
      if (!Array.isArray(list) || list.length < min || list.length > max) throw bad(min ? `Add at least ${min} ${what}.` : `Too many ${what}s.`);
      const seen = new Set<string>();
      return list.map((o: unknown) => {
        if (!isObj(o)) throw bad(`A ${what} is not valid.`);
        const n = str(o.name, `${what} name`, { min: 1, max: 60 }); const key = n.toLowerCase();
        if (seen.has(key)) throw bad(`Two ${what}s are called "${n}".`); seen.add(key);
        return { id: isUuid(o.id) ? o.id.toLowerCase() : null, name: n, price: num(o.price ?? 0, `${what} price`, { min: 0, max: 100000 }) };
      });
    };
    const variants = options(b.variants, 'variant', 1, 20); const addons = options(b.addons ?? [], 'add-on', 0, 30);
    const [cat] = await c.sql`select id from public.categories where name = ${str(b.category, 'Category', { min: 2, max: 40 })} and active`;
    if (!cat) throw bad('Choose one of the existing categories.');

    const foodId: string = await c.sql.begin(async (tx) => {
      let id: string;
      if (isUuid(b.id)) {
        const [u] = await tx`update public.foods set category_id = ${cat.id}::uuid, name = ${name}, description = ${description}, price = ${price}, original_price = ${original},
          stock = ${stock}, image = ${image}, veg = ${veg}, available = ${available}, tag = ${tag}, calories = ${calories}, prep_time = ${prepTime}
          where id = ${b.id}::uuid and deleted_at is null returning id`;
        if (!u) throw new HttpError(404, 'Dish not found.', 'NOT_FOUND');
        id = u.id;
      } else {
        const [n] = await tx`insert into public.foods (category_id, name, description, price, original_price, stock, image, veg, available, tag, calories, prep_time)
          values (${cat.id}::uuid, ${name}, ${description}, ${price}, ${original}, ${stock}, ${image}, ${veg}, ${available}, ${tag}, ${calories}, ${prepTime}) returning id`;
        id = n.id;
      }
      const existing = new Set((await tx`select id from public.food_options where food_id = ${id}::uuid`).map((o) => o.id));
      const keep: string[] = [];
      for (const [kind, list] of [['variant', variants], ['addon', addons]] as const) {
        for (const [i, o] of list.entries()) {
          if (o.id && existing.has(o.id)) {
            await tx`update public.food_options set name = ${o.name}, price = ${o.price}, sort_order = ${i}, active = true where id = ${o.id}::uuid`;
            keep.push(o.id);
          } else {
            const [n] = await tx`insert into public.food_options (food_id, kind, name, price, sort_order) values (${id}::uuid, ${kind}::public.option_kind, ${o.name}, ${o.price}, ${i}) returning id`;
            keep.push(n.id);
          }
        }
      }
      // Options the owner removed are hidden, not deleted, so old orders and carts stay readable.
      await tx`update public.food_options set active = false where food_id = ${id}::uuid and id not in (select jsonb_array_elements_text(${JSON.stringify(keep)}::text::jsonb)::uuid)`;
      await audit(tx, me, isUuid(b.id) ? 'menu.update' : 'menu.create', 'food', id, { name, price });
      return id;
    });
    const [food] = await loadFoods(c.sql, true, foodId);
    return c.reply(food, 201);
  });
  r.add('DELETE', '/owner/menu/:id', KITCHEN, async (c) => {
    const id = uuid(c.params.id);
    const [f] = await c.sql`update public.foods set deleted_at = now(), available = false where id = ${id}::uuid and deleted_at is null returning id, name`;
    if (!f) throw new HttpError(404, 'Dish not found.', 'NOT_FOUND');
    await audit(c.sql, c.me().id, 'menu.delete', 'food', id, { name: f.name });
    return c.reply({}, 204);
  });

  // ---- categories
  r.add('GET', '/owner/categories', KITCHEN, async (c) => {
    const rows = await c.sql`select id, name, image from public.categories order by sort_order, name`;
    return rows.map((x) => ({ id: x.id, name: x.name, ...(x.image ? { image: x.image } : {}) }));
  });
  r.add('POST', '/owner/categories', KITCHEN, async (c) => {
    const b = await c.json(); const name = str(b.name, 'Category name', { min: 2, max: 40 }); const image = httpsUrl(b.image, 'Image');
    const [row] = isUuid(b.id)
      ? await c.sql`update public.categories set name = ${name}, image = ${image} where id = ${b.id}::uuid returning id, name, image`
      : await c.sql`insert into public.categories (name, image, sort_order) values (${name}, ${image}, (select coalesce(max(sort_order), 0) + 1 from public.categories)) returning id, name, image`;
    if (!row) throw new HttpError(404, 'Category not found.', 'NOT_FOUND');
    await audit(c.sql, c.me().id, 'category.save', 'category', row.id, { name });
    return c.reply({ id: row.id, name: row.name, ...(row.image ? { image: row.image } : {}) }, 201);
  });
             }
