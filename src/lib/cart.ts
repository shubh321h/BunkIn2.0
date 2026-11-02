// Pure cart rules (no React, no storage) so they can be tested on their own.
import { CartLine, Food, Option } from './types';

export const MAX_LINE_QUANTITY = 20;
export const DEFAULT_SPICE = 'Medium';

/** The variant used when someone taps ADD on a card: the first one the menu lists. */
export const defaultVariant = (food: Food): Option | undefined => food.variants[0];

export const lineKey = (foodId: string, variantId: string, addonIds: string[], spice: string, instructions: string) =>
  [foodId, variantId, ...[...addonIds].sort(), spice, instructions].join('|');

export const foodLines = (cart: CartLine[], foodId: string) => cart.filter(l => l.food.id === foodId);
export const foodQuantity = (cart: CartLine[], foodId: string) => foodLines(cart, foodId).reduce((n, l) => n + l.quantity, 0);
export const cartCount = (cart: CartLine[]) => cart.reduce((n, l) => n + l.quantity, 0);

/**
 * The line a card's − / + buttons act on: the plain "default" line (default variant, no add-ons, default spice, no note),
 * otherwise the most recently added line of that dish. Matching by the real default variant (not by price) keeps the card
 * correct when the first variant is not the cheapest one.
 */
export function cardLine(cart: CartLine[], food: Food): CartLine | undefined {
  const lines = foodLines(cart, food.id);
  if (!lines.length) return undefined;
  const v = defaultVariant(food);
  const plain = lines.find(l => v && l.variant.id === v.id && l.addons.length === 0 && l.spice === DEFAULT_SPICE && l.instructions === '');
  return plain ?? lines[lines.length - 1];
}

export interface CartResult { cart: CartLine[]; error?: string; line?: CartLine }

/** How many of a dish may be in the bag in total (only known to staff; customers are checked again by the server). */
const stockCap = (food: Food) => (typeof food.stock === 'number' ? food.stock : Infinity);

export function addToCartLines(cart: CartLine[], food: Food, quantity = 1, variant: Option | undefined = defaultVariant(food), addons: Option[] = [], spice = DEFAULT_SPICE, instructions = ''): CartResult {
  if (!food.available) return { cart, error: 'This dish is currently sold out.' };
  if (!Number.isInteger(quantity) || quantity < 1) return { cart, error: 'Choose a quantity of at least 1.' };
  if (!variant || !food.variants.some(v => v.id === variant.id)) return { cart, error: 'Choose a size or variant for this dish.' };
  if (addons.some(a => !food.addons.some(x => x.id === a.id))) return { cart, error: 'One of the add-ons is no longer available.' };
  const key = lineKey(food.id, variant.id, addons.map(a => a.id), spice, instructions);
  const existing = cart.find(l => l.key === key);
  if (foodQuantity(cart, food.id) + quantity > stockCap(food)) return { cart, error: `Only ${food.stock} of ${food.name} left.` };
  if ((existing?.quantity ?? 0) + quantity > MAX_LINE_QUANTITY) return { cart, error: `You can order up to ${MAX_LINE_QUANTITY} of one dish.` };
  if (existing) {
    const line = { ...existing, quantity: existing.quantity + quantity };
    return { cart: cart.map(l => (l.key === key ? line : l)), line };
  }
  const line: CartLine = { key, food, quantity, variant, addons, spice, instructions };
  return { cart: [...cart, line], line };
}

/** Set a line's quantity. Zero (or less) removes the line. */
export function setLineQuantity(cart: CartLine[], key: string, quantity: number): CartResult {
  const line = cart.find(l => l.key === key);
  if (!line) return { cart };
  if (quantity <= 0) return { cart: cart.filter(l => l.key !== key) };
  if (quantity > MAX_LINE_QUANTITY) return { cart, error: `You can order up to ${MAX_LINE_QUANTITY} of one dish.` };
  const others = foodQuantity(cart, line.food.id) - line.quantity;
  if (others + quantity > stockCap(line.food)) return { cart, error: `Only ${line.food.stock} of ${line.food.name} left.` };
  return { cart: cart.map(l => (l.key === key ? { ...l, quantity } : l)) };
}

/**
 * Bring a saved bag up to date with the live menu: refresh prices and names, drop dishes, variants or add-ons that no
 * longer exist, and clamp quantities. Called only after the menu has loaded successfully.
 */
export function reconcileCart(cart: CartLine[], foods: Food[]): { cart: CartLine[]; notes: string[] } {
  const notes: string[] = [];
  const out = new Map<string, CartLine>();
  for (const line of cart) {
    const food = foods.find(f => f.id === line.food.id);
    if (!food || !food.available) { notes.push(`${line.food.name} is no longer available and was removed from your bag.`); continue; }
    const variant = food.variants.find(v => v.id === line.variant.id);
    const addons = line.addons.map(a => food.addons.find(x => x.id === a.id));
    if (!variant || addons.some(a => !a)) { notes.push(`${food.name} changed, so it was removed from your bag. Please add it again.`); continue; }
    const fresh = addons as Option[];
    const key = lineKey(food.id, variant.id, fresh.map(a => a.id), line.spice, line.instructions);
    const quantity = Math.min(line.quantity, MAX_LINE_QUANTITY);
    const previous = out.get(key);
    const merged = Math.min((previous?.quantity ?? 0) + quantity, MAX_LINE_QUANTITY);
    if (previous || line.food.price !== food.price || line.variant.price !== variant.price || fresh.some((a, i) => a.price !== line.addons[i].price)) {
      if (!previous) notes.push(`The price of ${food.name} changed. Your bag shows the new price.`);
    }
    out.set(key, { key, food, quantity: merged, variant, addons: fresh, spice: line.spice, instructions: line.instructions });
  }
  return { cart: [...out.values()], notes };
      }
