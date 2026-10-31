// Shared helpers: types, errors, input validation, responses.
export type Row = Record<string, any>;
export type Tx = (strings: TemplateStringsArray, ...values: any[]) => Promise<Row[]>;
export interface Db extends Tx { begin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }
export type Role = 'customer' | 'owner' | 'manager' | 'rider';

/** Operations only the server may do with the secret key (create / disable accounts). */
export interface AdminPort {
  createUser(input: { email: string; password: string; role: 'manager' | 'rider'; name: string }): Promise<{ id: string } | { error: 'exists' | 'failed' }>;
  setBanned(id: string, banned: boolean): Promise<boolean>;
  setPassword(id: string, password: string): Promise<boolean>;
}
export interface AuthPort {
  /** Returns the user id for a valid access token, otherwise null. */
  verify(token: string): Promise<string | null>;
  admin: AdminPort;
}
export interface Env { allowedOrigin?: string; onlinePayments?: boolean; rateLimitPerMinute?: number; checkoutsPerMinute?: number }

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR') { super(message); }
}
export const bad = (message: string, code = 'INVALID_REQUEST') => new HttpError(400, message, code);

const STATUS: Record<string, number> = {
  BAD_IDEMPOTENCY_KEY: 400, EMPTY_CART: 400, INVALID_ITEM: 400, INVALID_OPTION: 400, INVALID_ADDRESS: 400, INVALID_COUPON: 400,
  REASON_REQUIRED: 400, INVALID_RATING: 400, INVALID_TIMEZONE: 400, FORBIDDEN: 403, ACCOUNT_DISABLED: 403, NOT_FOUND: 404,
  STALE_LOCATION: 422, RATE_LIMITED: 429, SUPPORT_LIMIT: 429, OTP_LOCKED: 429,
};

/** Turn a database error into something safe to show. Unknown errors become a generic 500 (and are logged). */
export function fromDbError(e: any, requestId: string): HttpError {
  if (e instanceof HttpError) return e;
  const sqlstate = e?.code;
  if (sqlstate === 'P0001' && /^[A-Z_]+$/.test(e?.message ?? '')) {
    return new HttpError(STATUS[e.message] ?? 409, e.hint || e.message, e.message);
  }
  if (sqlstate === '23505') return new HttpError(409, 'That already exists.', 'DUPLICATE');
  if (sqlstate === '23514') return new HttpError(400, 'That value is not allowed. Check the numbers, links and location.', 'NOT_ALLOWED');
  if (sqlstate === '23503') return new HttpError(409, 'That item is still in use.', 'IN_USE');
  if (['22P02', '22003', '22007', '22023', '22001'].includes(sqlstate)) return new HttpError(400, 'One of the values is not valid.', 'INVALID_REQUEST');
  console.error(JSON.stringify({ requestId, level: 'error', sqlstate, message: String(e?.message ?? e).slice(0, 300) }));
  return new HttpError(500, 'Something went wrong on our side. Please try again.', 'SERVER_ERROR');
}

// ------------------------------------------------------------------ validation
export const isObj = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
export function obj(x: unknown): Row { if (!isObj(x)) throw bad('Invalid request.'); return x; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);
export function uuid(x: unknown, what = 'id'): string { if (!isUuid(x)) throw new HttpError(404, 'Not found.', 'NOT_FOUND'); return x.toLowerCase(); }
export function str(x: unknown, what: string, o: { min?: number; max?: number } = {}): string {
  if (typeof x !== 'string') throw bad(`${what} is required.`);
  const s = x.trim(); const min = o.min ?? 0, max = o.max ?? 200;
  if (s.length < min) throw bad(min <= 1 ? `${what} is required.` : `${what} must be at least ${min} characters.`);
  if (s.length > max) throw bad(`${what} must be at most ${max} characters.`);
  return s;
}
export const optStr = (x: unknown, what: string, o: { max?: number } = {}) => (x === undefined || x === null || x === '' ? '' : str(x, what, { max: o.max ?? 200 }));
export function num(x: unknown, what: string, o: { min?: number; max?: number; int?: boolean } = {}): number {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw bad(`${what} must be a number.`);
  if (o.int && !Number.isInteger(n)) throw bad(`${what} must be a whole number.`);
  if (o.min !== undefined && n < o.min) throw bad(`${what} must be at least ${o.min}.`);
  if (o.max !== undefined && n > o.max) throw bad(`${what} must be at most ${o.max}.`);
  return n;
}
export function bool(x: unknown, what: string): boolean { if (typeof x !== 'boolean') throw bad(`${what} must be true or false.`); return x; }
export const PHONE = /^[+]?[0-9 -]{10,15}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function phone(x: unknown, what = 'Phone number'): string { const s = str(x, what, { min: 10, max: 15 }); if (!PHONE.test(s)) throw bad(`${what} is not valid.`); return s; }
export function httpsUrl(x: unknown, what: string): string {
  const s = optStr(x, what, { max: 500 }); if (s === '') return '';
  if (!/^https:\/\/[^\s]+$/i.test(s)) return '';   // local bundled image keys and other values are stored as "no image"
  return s;
}
export function coords(x: unknown, what = 'Location'): { lat: number; lng: number } {
  const o = obj(x); return { lat: num(o.lat, `${what} latitude`, { min: -90, max: 90 }), lng: num(o.lng, `${what} longitude`, { min: -180, max: 180 }) };
}

// ------------------------------------------------------------------ responses
export function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.allowedOrigin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600', 'Vary': 'Origin',
  };
}
export function respond(env: Env, data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(data ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...corsHeaders(env), ...extra },
  });
}

/** Passwords handed to new staff. 14 random characters from an unambiguous alphabet plus a fixed suffix that satisfies password rules. */
export function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + '-7';
}
