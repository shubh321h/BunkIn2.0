// Reads that more than one route needs: the menu and the restaurant.
import type { Row, Tx } from './lib.ts';

/** Menu rows. Staff also see stock, hidden dishes and dishes in hidden categories. */
export async function loadFoods(sql: Tx, staff: boolean, onlyId?: string): Promise<Row[]> {
  const rows = await sql`
    select f.id, c.name as category, f.name, f.description, f.price, f.original_price, f.stock, f.image, f.veg, f.available,
           f.rating, f.review_count, f.tag, f.calories, f.prep_time,
           coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price) order by o.sort_order, o.name)
                     from public.food_options o where o.food_id = f.id and o.kind = 'variant' and o.active), '[]'::jsonb) as variants,
           coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price', o.price) order by o.sort_order, o.name)
                     from public.food_options o where o.food_id = f.id and o.kind = 'addon' and o.active), '[]'::jsonb) as addons
    from public.foods f join public.categories c on c.id = f.category_id
    where f.deleted_at is null and (c.active or ${staff}) and (${onlyId ?? null}::uuid is null or f.id = ${onlyId ?? null}::uuid)
    order by c.sort_order, f.name`;
  return rows.map((r) => ({
    id: r.id, name: r.name, category: r.category, description: r.description, price: r.price,
    ...(r.original_price != null ? { originalPrice: r.original_price } : {}),
    ...(staff && r.stock != null ? { stock: r.stock } : {}),
    image: r.image, veg: r.veg, available: r.available && (r.stock == null || r.stock > 0),
    rating: r.rating, reviews: r.review_count, ...(r.tag ? { tag: r.tag } : {}), calories: r.calories, prep: r.prep_time,
    variants: r.variants, addons: r.addons,
  }));
}

/** The restaurant. Customers get `open` = really accepting orders now (switch, holiday and hours). Staff get `open` = the switch itself. */
export async function loadRestaurant(sql: Tx, staff: boolean): Promise<Row> {
  const [r] = await sql`
    select name, phone, address, branding_image, lat, lng, delivery_fee, tax_rate, minimum_order, preparation_minutes, delivery_radius_km,
           is_open, to_char(opens_at, 'HH24:MI') as opens, to_char(closes_at, 'HH24:MI') as closes,
           coalesce((select string_agg(to_char(d, 'YYYY-MM-DD'), ',' order by d) from unnest(holidays) d), '') as holidays,
           (is_open
             and not ((now() at time zone timezone)::date = any (holidays))
             and (opens_at is null or closes_at is null
                  or case when opens_at <= closes_at
                       then (now() at time zone timezone)::time >= opens_at and (now() at time zone timezone)::time < closes_at
                       else (now() at time zone timezone)::time >= opens_at or (now() at time zone timezone)::time < closes_at end)) as accepting
    from public.restaurant`;
  return {
    name: r.name, open: staff ? r.is_open : r.accepting, acceptingOrders: r.accepting, location: { lat: r.lat, lng: r.lng },
    phone: r.phone, deliveryFee: r.delivery_fee, taxRate: r.tax_rate, minimumOrder: r.minimum_order,
    preparationMinutes: r.preparation_minutes, hours: r.opens && r.closes ? `${r.opens}–${r.closes}` : '', holidays: r.holidays,
    radius: r.delivery_radius_km, address: r.address, brandingImage: r.branding_image,
  };
}

export const couponJson = (r: Row) => ({
  code: r.code, title: r.title, description: r.description, minimum: r.minimum_order, type: r.kind, value: r.value, maxDiscount: r.max_discount,
});
